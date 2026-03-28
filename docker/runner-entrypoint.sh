#!/usr/bin/env bash
set -Eeuo pipefail

RUNNER_SOURCE_HOME="${RUNNER_SOURCE_HOME:-${RUNNER_HOME:-/actions-runner}}"
RUNNER_HOME="${RUNNER_HOME:-}"
runner_configured="false"
runner_exit_code=0
runner_exec_mode="runner"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

run_runner_bash() {
  local command="$1"
  shift || true

  if [[ "${runner_exec_mode}" == "root" ]]; then
    env RUNNER_ALLOW_RUNASROOT=1 RUNNER_EXECUTION_MODE="${runner_exec_mode}" "$@" bash -lc "${command}"
    return
  fi

  env RUNNER_EXECUTION_MODE="${runner_exec_mode}" "$@" gosu runner bash -lc "${command}"
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
  mkdir -p "${RUNNER_TEMP}"
  find "${RUNNER_WORK_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  find "${RUNNER_TEMP}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
}

prepare_runner_home() {
  if [[ -z "${RUNNER_HOME}" ]]; then
    RUNNER_HOME="${RUNNER_STATE_DIR%/}/runner-home"
  fi

  if [[ "${RUNNER_HOME}" == "${RUNNER_SOURCE_HOME}" ]]; then
    log "runner home is using image source directory ${RUNNER_SOURCE_HOME}"
    return
  fi

  rm -rf "${RUNNER_HOME}"
  mkdir -p "${RUNNER_HOME}"
  tar -C "${RUNNER_SOURCE_HOME}" -cf - . | tar --no-same-owner --no-same-permissions -C "${RUNNER_HOME}" -xf -

  if [[ "${runner_exec_mode}" == "root" ]]; then
    chmod -R u+rwX "${RUNNER_HOME}"
  else
    chown -R runner:runner "${RUNNER_HOME}"
  fi
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

  if ! run_runner_bash \
    "cd '${RUNNER_HOME}' && ./config.sh remove --token \"\${RUNNER_TOKEN}\"" \
    "RUNNER_TOKEN=${remove_token}"; then
    log "runner removal command failed; check GitHub runner inventory for stale registrations"
    return 0
  fi

  cleanup_local_state
  log "runner registration removed cleanly"
}

prepare_runtime_dirs() {
  mkdir -p "${RUNNER_TEMP}" "${RUNNER_TOOL_CACHE}"

  if [[ "${runner_exec_mode}" == "root" ]]; then
    chmod -R u+rwX "${RUNNER_TEMP}" "${RUNNER_TOOL_CACHE}"
    return
  fi

  chown -R runner:runner "${RUNNER_TEMP}" "${RUNNER_TOOL_CACHE}"
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
: "${RUNNER_REPOSITORY_ACCESS:=selected}"
: "${RUNNER_HOME:=${RUNNER_STATE_DIR%/}/runner-home}"
: "${RUNNER_TEMP:=/tmp/github-runner-temp}"
: "${RUNNER_TOOL_CACHE:=/opt/hostedtoolcache}"
: "${AGENT_TOOLSDIRECTORY:=${RUNNER_TOOL_CACHE}}"
: "${RUNNER_EXEC_MODE_OVERRIDE:=}"

if [[ "${RUNNER_SCOPE}" != "organization" ]]; then
  log "RUNNER_SCOPE=${RUNNER_SCOPE} is unsupported in v1; only organization runners are implemented"
  exit 1
fi

prepare_state_dir() {
  local probe_file

  mkdir -p "${RUNNER_STATE_DIR}" "${RUNNER_LOG_DIR}" "${RUNNER_WORK_DIR}"

  if [[ -n "${RUNNER_EXEC_MODE_OVERRIDE}" ]]; then
    case "${RUNNER_EXEC_MODE_OVERRIDE}" in
      root|runner)
        runner_exec_mode="${RUNNER_EXEC_MODE_OVERRIDE}"
        log "runner execution mode override: ${runner_exec_mode}"
        return
        ;;
      *)
        log "invalid RUNNER_EXEC_MODE_OVERRIDE=${RUNNER_EXEC_MODE_OVERRIDE}; expected root or runner"
        exit 1
        ;;
    esac
  fi

  if ! chown -R runner:runner "${RUNNER_STATE_DIR}" 2>/dev/null; then
    log "state directory ownership update failed for ${RUNNER_STATE_DIR}; falling back to root runner execution for Synology-compatible bind mounts"
    runner_exec_mode="root"
    return
  fi

  probe_file="${RUNNER_LOG_DIR}/.runner-write-test"
  if ! gosu runner bash -lc "touch '${probe_file}' && rm -f '${probe_file}'"; then
    log "runner user cannot write to ${RUNNER_STATE_DIR}; falling back to root runner execution"
    runner_exec_mode="root"
  fi
}

prepare_state_dir
prepare_runtime_dirs
prepare_runner_home

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
log "repository access: ${RUNNER_REPOSITORY_ACCESS}"
if [[ "${RUNNER_REPOSITORY_ACCESS}" == "all" ]]; then
  log "allowed repositories: all repositories in ${GITHUB_ORG}"
else
  log "allowed repositories: ${RUNNER_ALLOWED_REPOSITORIES:-unset}"
fi
if [[ "${runner_exec_mode}" == "root" ]]; then
  log "runner execution mode: root fallback"
else
  log "runner execution mode: runner user"
fi
log "runner source home: ${RUNNER_SOURCE_HOME}"
log "runner writable home: ${RUNNER_HOME}"
run_runner_bash "cd '${RUNNER_HOME}' && ./config.sh ${config_args[*]@Q}"
runner_configured="true"

log "starting runner ${RUNNER_NAME}"
run_runner_bash "cd '${RUNNER_HOME}' && exec ./run.sh" \
  2>&1 | tee -a "${RUNNER_LOG_DIR}/runner.log"
