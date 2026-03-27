#!/usr/bin/env bash
set -Eeuo pipefail

RUNNER_HOME="${RUNNER_HOME:-/actions-runner}"
runner_configured="false"
runner_exit_code=0

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log "missing required environment variable: ${name}"
    exit 1
  fi
}

github_api_post() {
  local endpoint="$1"
  local tmp status body

  tmp="$(mktemp)"
  status="$(
    curl -sS \
      -o "${tmp}" \
      -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${GITHUB_PAT}" \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: synology-github-runner" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "${GITHUB_API_URL%/}${endpoint}"
  )"
  body="$(cat "${tmp}")"
  rm -f "${tmp}"

  if [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    log "GitHub API POST ${endpoint} failed with ${status}: ${body}"
    return 1
  fi

  printf '%s' "${body}"
}

request_runner_token() {
  local kind="$1"
  local endpoint

  case "${kind}" in
    registration)
      endpoint="/orgs/${GITHUB_ORG}/actions/runners/registration-token"
      ;;
    remove)
      endpoint="/orgs/${GITHUB_ORG}/actions/runners/remove-token"
      ;;
    *)
      log "unsupported token kind: ${kind}"
      return 1
      ;;
  esac

  github_api_post "${endpoint}" | jq -r '.token // empty'
}

cleanup_local_state() {
  rm -f \
    "${RUNNER_HOME}/.runner" \
    "${RUNNER_HOME}/.credentials" \
    "${RUNNER_HOME}/.credentials_rsaparams"
  mkdir -p "${RUNNER_WORK_DIR}"
  find "${RUNNER_WORK_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

cleanup_runner() {
  if [[ "${runner_configured}" != "true" ]]; then
    return 0
  fi

  log "requesting remove token for ${RUNNER_NAME}"
  local remove_token
  if ! remove_token="$(request_runner_token remove)"; then
    log "remove token request failed; leaving GitHub runner registration in place for manual cleanup"
    return 0
  fi

  if [[ -z "${remove_token}" ]]; then
    log "remove token response was empty; leaving GitHub runner registration in place for manual cleanup"
    return 0
  fi

  if ! RUNNER_TOKEN="${remove_token}" gosu runner bash -lc 'cd "${RUNNER_HOME}" && ./config.sh remove --token "${RUNNER_TOKEN}"'; then
    log "runner removal command failed; check GitHub runner inventory for stale registrations"
    return 0
  fi

  cleanup_local_state
  log "runner registration removed cleanly"
}

on_exit() {
  runner_exit_code=$?
  cleanup_runner
  exit "${runner_exit_code}"
}

trap on_exit EXIT
trap 'log "termination requested"; exit 0' TERM INT

require_env GITHUB_PAT
require_env GITHUB_ORG
require_env RUNNER_NAME
require_env RUNNER_LABELS
require_env RUNNER_STATE_DIR
require_env RUNNER_LOG_DIR
require_env RUNNER_WORK_DIR

: "${GITHUB_API_URL:=https://api.github.com}"
: "${RUNNER_SCOPE:=organization}"
: "${RUNNER_EPHEMERAL:=true}"
: "${RUNNER_DISABLE_UPDATE:=true}"

if [[ "${RUNNER_SCOPE}" != "organization" ]]; then
  log "RUNNER_SCOPE=${RUNNER_SCOPE} is unsupported in v1; only organization runners are implemented"
  exit 1
fi

mkdir -p "${RUNNER_STATE_DIR}" "${RUNNER_LOG_DIR}" "${RUNNER_WORK_DIR}"
chown -R runner:runner "${RUNNER_STATE_DIR}"

registration_token="$(request_runner_token registration)"
if [[ -z "${registration_token}" ]]; then
  log "registration token response was empty"
  exit 1
fi

config_args=(
  --unattended
  --url "https://github.com/${GITHUB_ORG}"
  --token "${registration_token}"
  --name "${RUNNER_NAME}"
  --work "${RUNNER_WORK_DIR}"
  --labels "${RUNNER_LABELS}"
  --replace
)

if [[ -n "${RUNNER_GROUP:-}" ]]; then
  config_args+=(--runnergroup "${RUNNER_GROUP}")
fi

if [[ "${RUNNER_EPHEMERAL}" == "true" ]]; then
  config_args+=(--ephemeral)
fi

if [[ "${RUNNER_DISABLE_UPDATE}" == "true" ]]; then
  config_args+=(--disableupdate)
fi

cleanup_local_state

log "configuring runner ${RUNNER_NAME} in group ${RUNNER_GROUP:-default}"
log "allowed repositories: ${RUNNER_ALLOWED_REPOSITORIES:-unset}"
gosu runner bash -lc "cd '${RUNNER_HOME}' && ./config.sh ${config_args[*]@Q}"
runner_configured="true"

log "starting runner ${RUNNER_NAME}"
gosu runner bash -lc "cd '${RUNNER_HOME}' && exec ./run.sh" \
  2>&1 | tee -a "${RUNNER_LOG_DIR}/runner.log"
