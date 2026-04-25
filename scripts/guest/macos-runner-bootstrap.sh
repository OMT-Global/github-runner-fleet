#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/github-runner-common.sh"

RUNNER_CONFIGURED="false"

cleanup_local_state() {
  rm -f \
    "${RUNNER_ROOT}/.runner" \
    "${RUNNER_ROOT}/.credentials" \
    "${RUNNER_ROOT}/.credentials_rsaparams"
  mkdir -p "${RUNNER_WORK_DIR}"
  find "${RUNNER_WORK_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

download_runner_bundle() {
  local asset_name="actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
  local archive_path="${RUNNER_ROOT}/${asset_name}"
  local download_url="${RUNNER_DOWNLOAD_URL:-https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${asset_name}}"

  mkdir -p "${RUNNER_ROOT}"

  if [[ ! -f "${archive_path}" ]]; then
    curl -fsSL -o "${archive_path}" "${download_url}"
  fi

  rm -rf "${RUNNER_ROOT}/bin" "${RUNNER_ROOT}/externals"
  find "${RUNNER_ROOT}" -mindepth 1 -maxdepth 1 \
    ! -name "${asset_name}" \
    ! -name "_work" \
    -exec rm -rf {} +
  tar -xzf "${archive_path}" -C "${RUNNER_ROOT}"
  printf '%s\n' "${RUNNER_VERSION}" > "${RUNNER_ROOT}/.runner-version"
}

prepare_runner_home() {
  local work_link="${RUNNER_ROOT}/_work"

  if [[ ! -x "${RUNNER_ROOT}/config.sh" ]] || [[ ! -f "${RUNNER_ROOT}/.runner-version" ]] || [[ "$(cat "${RUNNER_ROOT}/.runner-version")" != "${RUNNER_VERSION}" ]]; then
    download_runner_bundle
  fi

  mkdir -p "${RUNNER_WORK_DIR}"
  ln -sfn "${RUNNER_WORK_DIR}" "${work_link}"
  chmod +x "${RUNNER_ROOT}/config.sh" "${RUNNER_ROOT}/run.sh"
}

cleanup_runner() {
  if [[ ! -f "${RUNNER_ROOT}/.runner" ]]; then
    log "runner registration already removed by ephemeral listener"
    cleanup_local_state
    return 0
  fi

  cleanup_runner_registration "cd '${RUNNER_ROOT}' && ./config.sh remove --token \"\${RUNNER_REMOVE_TOKEN}\""
}

on_exit() {
  local exit_code=$?
  cleanup_runner
  exit "${exit_code}"
}

trap on_exit EXIT

require_env GITHUB_PAT
require_env GITHUB_API_URL
require_env GITHUB_ORG
require_env RUNNER_GROUP
require_env RUNNER_LABELS
require_env RUNNER_NAME
require_env RUNNER_ROOT
require_env RUNNER_WORK_DIR
require_env RUNNER_VERSION

export PATH="${RUNNER_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.local/bin}"

prepare_runner_home
cleanup_local_state

registration_token="$(request_runner_token registration)"
if [[ -z "${registration_token}" ]]; then
  log "registration token response was empty"
  exit 1
fi

config_args=(
  --unattended
  --replace
  --disableupdate
  --ephemeral
  --url "https://github.com/${GITHUB_ORG}"
  --token "${registration_token}"
  --name "${RUNNER_NAME}"
  --runnergroup "${RUNNER_GROUP}"
  --labels "${RUNNER_LABELS}"
  --work "_work"
)

log "configuring ephemeral macOS runner ${RUNNER_NAME} in group ${RUNNER_GROUP}"
(
  cd "${RUNNER_ROOT}"
  ./config.sh "${config_args[@]}"
)
RUNNER_CONFIGURED="true"

log "starting runner ${RUNNER_NAME}"
(
  cd "${RUNNER_ROOT}"
  ./run.sh
)
