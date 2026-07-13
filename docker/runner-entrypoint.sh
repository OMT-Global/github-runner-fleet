#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source /usr/local/lib/github-runner-common.sh

RUNNER_SOURCE_HOME="${RUNNER_SOURCE_HOME:-${RUNNER_HOME:-/actions-runner}}"
RUNNER_HOME="${RUNNER_HOME:-}"
runner_configured="false"
runner_exit_code=0
runner_exec_mode="runner"
RUNNER_AUDIT_DEREGISTER_EVENT="runner_deregistered"
github_token_for_cleanup=""
github_app_id_for_cleanup=""
github_app_installation_id_for_cleanup=""
github_app_private_key_for_cleanup=""

run_runner_bash() {
  local command="$1"
  shift || true

  if [[ "${runner_exec_mode}" == "root" ]]; then
    env "$@" RUNNER_ALLOW_RUNASROOT=1 RUNNER_EXECUTION_MODE="${runner_exec_mode}" bash -lc "${command}"
    return
  fi

  env "$@" RUNNER_EXECUTION_MODE="${runner_exec_mode}" gosu runner bash -lc "${command}"
}

run_actions_runner() {
  run_runner_bash "cd '${RUNNER_HOME}' && exec ./run.sh" \
    -u GITHUB_PAT \
    -u GITHUB_TOKEN \
    -u GH_TOKEN \
    -u GITHUB_APP_ID \
    -u GITHUB_APP_INSTALLATION_ID \
    -u GITHUB_APP_PRIVATE_KEY
}

verify_docker_api_compatibility() {
  local minimum_server_api="${DOCKER_MIN_SERVER_API_VERSION:-1.44}"
  local version_output
  local server_api

  if [[ ",${RUNNER_LABELS}," != *",docker-capable,"* && "${FLEET_PLANE:-}" != "linux-docker" ]]; then
    return
  fi

  log "checking Docker client/server compatibility (minimum server API ${minimum_server_api})"
  if ! version_output="$(run_runner_bash "docker version --format 'client_version={{.Client.Version}} client_api={{.Client.APIVersion}} server_version={{.Server.Version}} server_api={{.Server.APIVersion}}'")"; then
    log "Docker compatibility preflight failed for ${RUNNER_NAME}: the runner execution account cannot negotiate with ${DOCKER_HOST:-the configured daemon}"
    exit 1
  fi
  log "Docker compatibility preflight: ${version_output}"

  server_api="$(printf '%s\n' "${version_output}" | sed -n 's/.*server_api=\([^ ]*\).*/\1/p')"
  if [[ -z "${server_api}" ]]; then
    log "Docker compatibility preflight failed: docker version did not report server_api"
    exit 1
  fi
  if [[ "$(printf '%s\n%s\n' "${minimum_server_api}" "${server_api}" | sort -V | sed -n '1p')" != "${minimum_server_api}" ]]; then
    log "Docker compatibility preflight failed: server API ${server_api} is older than required ${minimum_server_api}"
    exit 1
  fi
}

run_runner_job_bash() {
  local command="$1"
  shift || true

  if [[ "${runner_exec_mode}" == "root" ]]; then
    env \
      -u GITHUB_PAT \
      -u GITHUB_TOKEN \
      -u GH_TOKEN \
      -u GITHUB_APP_ID \
      -u GITHUB_APP_INSTALLATION_ID \
      -u GITHUB_APP_PRIVATE_KEY \
      RUNNER_ALLOW_RUNASROOT=1 \
      RUNNER_EXECUTION_MODE="${runner_exec_mode}" \
      "$@" bash -lc "${command}"
    return
  fi

  env \
    -u GITHUB_PAT \
    -u GITHUB_TOKEN \
    -u GH_TOKEN \
    -u GITHUB_APP_ID \
    -u GITHUB_APP_INSTALLATION_ID \
    -u GITHUB_APP_PRIVATE_KEY \
    RUNNER_EXECUTION_MODE="${runner_exec_mode}" \
    "$@" gosu runner bash -lc "${command}"
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
  export GITHUB_PAT="${github_token_for_cleanup}"
  export GITHUB_APP_ID="${github_app_id_for_cleanup}"
  export GITHUB_APP_INSTALLATION_ID="${github_app_installation_id_for_cleanup}"
  export GITHUB_APP_PRIVATE_KEY="${github_app_private_key_for_cleanup}"
  cleanup_runner_registration "run_runner_bash \"cd '${RUNNER_HOME}' && ./config.sh remove --token \\\"\\\${RUNNER_REMOVE_TOKEN}\\\"\""
  unset GITHUB_PAT GITHUB_APP_ID GITHUB_APP_INSTALLATION_ID GITHUB_APP_PRIVATE_KEY
}

stash_github_auth_for_cleanup() {
  github_token_for_cleanup="${GITHUB_PAT:-}"
  github_app_id_for_cleanup="${GITHUB_APP_ID:-}"
  github_app_installation_id_for_cleanup="${GITHUB_APP_INSTALLATION_ID:-}"
  github_app_private_key_for_cleanup="${GITHUB_APP_PRIVATE_KEY:-}"
}

scrub_github_auth_env() {
  unset GITHUB_PAT GITHUB_TOKEN GH_TOKEN GITHUB_APP_ID GITHUB_APP_INSTALLATION_ID GITHUB_APP_PRIVATE_KEY
}

prepare_runtime_dirs() {
  mkdir -p "${RUNNER_WORK_DIR}" "${RUNNER_TEMP}" "${RUNNER_TOOL_CACHE}"

  if [[ "${runner_exec_mode}" == "root" ]]; then
    ensure_root_runtime_dir "${RUNNER_WORK_DIR}"
    ensure_root_runtime_dir "${RUNNER_TEMP}"
    ensure_root_tool_cache "${RUNNER_TOOL_CACHE}"
    return
  fi

  chown -R runner:runner "${RUNNER_WORK_DIR}" "${RUNNER_TEMP}" "${RUNNER_TOOL_CACHE}"
}

prepare_audit_log() {
  local audit_dir

  : "${AUDIT_LOG_FILE:=/var/log/runner-fleet/audit.jsonl}"
  audit_dir="$(dirname "${AUDIT_LOG_FILE}")"
  mkdir -p "${audit_dir}"
  touch "${AUDIT_LOG_FILE}"
  chmod 0600 "${AUDIT_LOG_FILE}" 2>/dev/null || true

  if [[ "${runner_exec_mode}" != "root" ]]; then
    chown runner:runner "${audit_dir}" "${AUDIT_LOG_FILE}" 2>/dev/null || true
  fi
}

install_runner_hooks() {
  local hook_dir="${RUNNER_STATE_DIR%/}/hooks"
  local job_started_hook="${hook_dir}/job-started.sh"

  mkdir -p "${hook_dir}"
  cat > "${job_started_hook}" <<'HOOK'
#!/usr/bin/env bash
set -Eeuo pipefail
source /usr/local/lib/github-runner-common.sh
audit_event runner_job_start
HOOK
  chmod 0755 "${job_started_hook}"
  if [[ "${runner_exec_mode}" != "root" ]]; then
    chown -R runner:runner "${hook_dir}" 2>/dev/null || true
  fi

  export ACTIONS_RUNNER_HOOK_JOB_STARTED="${job_started_hook}"
}

ensure_root_runtime_dir() {
  local dir="$1"

  if chmod -R u+rwX "${dir}" 2>/dev/null; then
    return
  fi

  log "runtime directory permission update failed for ${dir}; recreating it for root runner execution"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  chmod -R u+rwX "${dir}"
}

ensure_root_tool_cache() {
  local dir="$1"

  mkdir -p "${dir}"

  if chmod u+rwx "${dir}" 2>/dev/null; then
    return
  fi

  log "tool cache top-level permission update failed for ${dir}; preserving baked-in tool cache for root runner execution"
}

on_exit() {
  runner_exit_code=$?
  cleanup_runner
  exit "${runner_exit_code}"
}

trap on_exit EXIT
trap 'log "termination requested"; RUNNER_AUDIT_DEREGISTER_EVENT="runner_evicted"; export RUNNER_AUDIT_DEREGISTER_EVENT; exit 0' TERM INT

require_github_auth
stash_github_auth_for_cleanup
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
verify_docker_api_compatibility
prepare_runner_home
prepare_audit_log
install_runner_hooks

if ! registration_token="$(request_runner_token registration)"; then
  audit_event token_fetch_failed
  exit 1
fi
if [[ -z "${registration_token}" ]]; then
  log "registration token response was empty"
  audit_event token_fetch_failed
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
audit_event runner_registered

log "starting runner ${RUNNER_NAME}"
scrub_github_auth_env
run_runner_job_bash "cd '${RUNNER_HOME}' && exec ./run.sh" \
  2>&1 | tee -a "${RUNNER_LOG_DIR}/runner.log"
