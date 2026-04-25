#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") --slot N [options]

Stop and delete one Lume slot VM and clear its tracked VM PID file.

Options:
  --slot N       Slot number to destroy
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

if vm_exists; then
  log "stopping ${LUME_VM_NAME}"
  lume stop "${LUME_VM_NAME}" $(storage_args) >/dev/null 2>&1 || true
  sleep 2
  log "deleting ${LUME_VM_NAME}"
  lume delete "${LUME_VM_NAME}" --force $(storage_args) >/dev/null 2>&1 || true
fi

if [[ -f "${LUME_SLOT_VM_PID_FILE}" ]]; then
  kill "$(cat "${LUME_SLOT_VM_PID_FILE}")" >/dev/null 2>&1 || true
  rm -f "${LUME_SLOT_VM_PID_FILE}"
fi
