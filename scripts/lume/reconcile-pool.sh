#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"
once=false
dry_run=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      config_path="$2"
      shift 2
      ;;
    --env)
      env_path="$2"
      shift 2
      ;;
    --once)
      once=true
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

pool_size="$(load_pool_size "${config_path}" "${env_path}")"
load_slot_env "1" "${config_path}" "${env_path}"

if ! base_vm_exists; then
  echo "base VM ${LUME_VM_BASE_NAME} does not exist; create or rotate it before reconciling the pool" >&2
  exit 1
fi

log "reconciling Lume runner pool with ${pool_size} slots"

reconcile_once() {
  local slot worker_running action

  for slot in $(seq 1 "${pool_size}"); do
    load_slot_env "${slot}" "${config_path}" "${env_path}"
    mkdir -p "${LUME_SLOT_DIR}" "$(dirname "${LUME_SLOT_LOG_FILE}")"

    worker_running=false
    if [[ -f "${LUME_SLOT_WORKER_PID_FILE}" ]] && kill -0 "$(cat "${LUME_SLOT_WORKER_PID_FILE}")" >/dev/null 2>&1; then
      worker_running=true
    fi

    if [[ "${worker_running}" == true ]]; then
      action="healthy"
    elif vm_exists; then
      action="restart-worker"
    else
      action="create-slot"
    fi

    if [[ "${dry_run}" == true ]]; then
      printf 'slot=%s vm=%s action=%s log=%s\n' \
        "${slot}" \
        "${LUME_VM_NAME}" \
        "${action}" \
        "${LUME_SLOT_LOG_FILE}"
      continue
    fi

    if [[ "${action}" == "healthy" ]]; then
      continue
    fi

    log "starting slot worker ${slot} (${LUME_VM_NAME}) action=${action}"
    nohup "${SCRIPT_DIR}/run-slot.sh" --slot "${slot}" --config "${config_path}" --env "${env_path}" \
      >> "${LUME_SLOT_LOG_FILE}" 2>&1 &
    echo $! > "${LUME_SLOT_WORKER_PID_FILE}"
  done
}

while true; do
  reconcile_once

  if [[ "${once}" == true || "${dry_run}" == true ]]; then
    break
  fi

  sleep 15
done
