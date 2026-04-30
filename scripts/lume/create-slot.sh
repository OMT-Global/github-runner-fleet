#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") --slot N [options]

Clone and start one Lume slot VM, then wait for SSH readiness.

Options:
  --slot N       Slot number to create
  --config PATH  Runner config file (default: $(default_lume_config_path))
  --env PATH     Env file with GitHub/Lume settings (default: $(default_lume_env_path))
  -h, --help     Show this help text
EOF
}

slot=""
config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --slot)
      slot="$2"
      shift 2
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

if [[ -z "${slot}" ]]; then
  usage >&2
  echo "--slot is required" >&2
  exit 1
fi

load_slot_env "${slot}" "${config_path}" "${env_path}"
mkdir -p "${LUME_SLOT_DIR}" "$(dirname "${LUME_SLOT_LOG_FILE}")"

if vm_exists; then
  log "slot VM ${LUME_VM_NAME} already exists"
  exit 0
fi

log "cloning ${LUME_VM_BASE_NAME} -> ${LUME_VM_NAME}"
lume clone "${LUME_VM_BASE_NAME}" "${LUME_VM_NAME}" $(clone_args) >/dev/null
lume set "${LUME_VM_NAME}" --cpu "${LUME_VM_CPU}" --memory "${LUME_VM_MEMORY}" --disk-size "${LUME_VM_DISK_SIZE}" $(storage_args) >/dev/null

log "starting ${LUME_VM_NAME}"
vm_pid="$(
  spawn_detached \
    "${LUME_SLOT_VM_LOG_FILE}" \
    lume run "${LUME_VM_NAME}" --no-display --network "${LUME_VM_NETWORK}" $(storage_args)
)"
echo "${vm_pid}" > "${LUME_SLOT_VM_PID_FILE}"

wait_for_ssh
log "slot ${LUME_VM_NAME} is reachable over SSH"
