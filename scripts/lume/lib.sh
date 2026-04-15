#!/usr/bin/env bash
set -Eeuo pipefail

LUME_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LUME_LIB_DIR}/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/github-runner-common.sh"

default_lume_config_path() {
  printf '%s/config/lume-runners.yaml' "${REPO_ROOT}"
}

default_lume_env_path() {
  printf '%s/.env' "${REPO_ROOT}"
}

default_lume_unattended_path() {
  printf '%s/scripts/lume/unattended-sequoia.yml' "${REPO_ROOT}"
}

load_slot_env() {
  local slot="$1"
  local config_path="$2"
  local env_path="$3"

  pushd "${REPO_ROOT}" >/dev/null
  eval "$(
    pnpm exec tsx src/cli.ts render-lume-runner-manifest \
      --config "${config_path}" \
      --env "${env_path}" \
      --slot "${slot}" \
      --format shell
  )"
  popd >/dev/null
}

latest_ipsw_url() {
  lume ipsw | tail -n 1
}

resolve_lume_ipsw_path() {
  if [[ -n "${LUME_HOST_IPSW_PATH:-}" ]]; then
    printf '%s\n' "${LUME_HOST_IPSW_PATH}"
    return 0
  fi

  local ipsw_url
  ipsw_url="$(latest_ipsw_url)"
  printf '%s/cache/%s\n' "${LUME_HOST_BASE_DIR}" "$(basename "${ipsw_url}")"
}

ensure_cached_lume_ipsw() {
  local target_path="$1"
  local ipsw_url
  local partial_path

  mkdir -p "$(dirname "${target_path}")"
  if [[ -s "${target_path}" ]]; then
    log "reusing cached IPSW ${target_path}"
    printf '%s\n' "${target_path}"
    return 0
  fi

  ipsw_url="$(latest_ipsw_url)"
  partial_path="${target_path}.partial"
  log "downloading IPSW ${ipsw_url} -> ${target_path}"
  curl -fL --continue-at - --output "${partial_path}" "${ipsw_url}"
  mv "${partial_path}" "${target_path}"
  printf '%s\n' "${target_path}"
}

load_pool_size() {
  local config_path="$1"
  local env_path="$2"

  pushd "${REPO_ROOT}" >/dev/null
  pnpm exec tsx src/cli.ts validate-lume-config \
    --config "${config_path}" \
    --env "${env_path}" \
    | node --input-type=module -e 'let data="";process.stdin.on("data",(chunk)=>data+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(data);process.stdout.write(String(parsed.pool.size));});'
  popd >/dev/null
}

storage_args() {
  if [[ -n "${LUME_VM_STORAGE:-}" ]]; then
    printf '%s\n' "--storage" "${LUME_VM_STORAGE}"
  fi
}

clone_args() {
  if [[ -n "${LUME_VM_STORAGE:-}" ]]; then
    printf '%s\n' "--source-storage" "${LUME_VM_STORAGE}" "--dest-storage" "${LUME_VM_STORAGE}"
  fi
}

wait_for_ssh() {
  local attempt

  for attempt in $(seq 1 60); do
    if lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 10 "true" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  log "timed out waiting for SSH on ${LUME_VM_NAME}"
  return 1
}

upload_guest_file() {
  local source_path="$1"
  local destination_path="$2"
  local content

  content="$(base64 < "${source_path}" | tr -d '\n')"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 0 \
    "mkdir -p '$(dirname "${destination_path}")' && printf '%s' '${content}' | base64 -D > '${destination_path}' && chmod 0755 '${destination_path}'"
}

upload_env_file() {
  local destination_path="$1"
  local source_path="${2:-${LUME_HOST_ENV_FILE}}"
  local content

  content="$(base64 < "${source_path}" | tr -d '\n')"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 0 \
    "mkdir -p '$(dirname "${destination_path}")' && printf '%s' '${content}' | base64 -D > '${destination_path}' && chmod 0600 '${destination_path}'"
}

render_guest_runner_env() {
  local env_path="$1"
  local temp_env

  temp_env="$(mktemp)"
  (
    set -a
    # shellcheck disable=SC1090
    source "${env_path}"
    set +a

    cat <<EOF
GITHUB_PAT=${GITHUB_PAT}
GITHUB_API_URL=${GITHUB_API_URL}
GITHUB_REPO=${GITHUB_REPO:-}
GITHUB_ORG=${GITHUB_ORG}
RUNNER_GROUP=${RUNNER_GROUP}
RUNNER_LABELS=${RUNNER_LABELS}
RUNNER_NAME=${RUNNER_NAME}
RUNNER_ROOT=${RUNNER_ROOT}
RUNNER_WORK_DIR=${RUNNER_WORK_DIR}
RUNNER_VERSION=${RUNNER_VERSION}
RUNNER_DOWNLOAD_URL=${RUNNER_DOWNLOAD_URL:-}
EOF
  ) > "${temp_env}"

  printf '%s\n' "${temp_env}"
}

vm_exists() {
  lume get "${LUME_VM_NAME}" --format json $(storage_args) >/dev/null 2>&1
}
