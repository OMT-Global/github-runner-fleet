#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Show local worker/VM state for each configured Lume slot.

Options:
  --config PATH  Runner config file (default: $(default_lume_config_path))
  --env PATH     Env file with GitHub/Lume settings (default: $(default_lume_env_path))
  -h, --help     Show this help text
EOF
}

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --config)
      config_path="$2"
      shift 2
      ;;
    --env)
      env_path="$2"
      shift 2
      ;;
    *)
      usage >&2
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

pool_size="$(load_pool_size "${config_path}" "${env_path}")"

for slot in $(seq 1 "${pool_size}"); do
  load_slot_env "${slot}" "${config_path}" "${env_path}"
  worker_status="stopped"
  vm_status="missing"

  if [[ -f "${LUME_SLOT_WORKER_PID_FILE}" ]] && kill -0 "$(cat "${LUME_SLOT_WORKER_PID_FILE}")" >/dev/null 2>&1; then
    worker_status="running"
  fi

  if vm_exists; then
    vm_status="present"
  fi

  printf '%s worker=%s vm=%s log=%s vm_log=%s\n' \
    "${LUME_VM_NAME}" \
    "${worker_status}" \
    "${vm_status}" \
    "${LUME_SLOT_LOG_FILE}" \
    "${LUME_SLOT_VM_LOG_FILE}"
done
