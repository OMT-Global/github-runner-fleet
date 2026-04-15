#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"

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
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

pool_size="$(load_pool_size "${config_path}" "${env_path}")"
log "reconciling Lume runner pool with ${pool_size} slots"

while true; do
  for slot in $(seq 1 "${pool_size}"); do
    load_slot_env "${slot}" "${config_path}" "${env_path}"
    mkdir -p "${LUME_SLOT_DIR}" "$(dirname "${LUME_SLOT_LOG_FILE}")"

    if [[ -f "${LUME_SLOT_WORKER_PID_FILE}" ]] && kill -0 "$(cat "${LUME_SLOT_WORKER_PID_FILE}")" >/dev/null 2>&1; then
      continue
    fi

    log "starting slot worker ${slot} (${LUME_VM_NAME})"
    nohup "${SCRIPT_DIR}/run-slot.sh" --slot "${slot}" --config "${config_path}" --env "${env_path}" \
      >> "${LUME_SLOT_LOG_FILE}" 2>&1 &
    echo $! > "${LUME_SLOT_WORKER_PID_FILE}"
  done

  sleep 15
done
