#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") --slot N [options]

Run one long-lived slot worker that creates, boots, registers, and recycles an ephemeral VM runner.

Options:
  --slot N       Slot number to reconcile
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
echo $$ > "${LUME_SLOT_WORKER_PID_FILE}"
guest_env_file=""

cleanup_slot() {
  if [[ -n "${guest_env_file}" ]]; then
    rm -f "${guest_env_file}"
    guest_env_file=""
  fi
  "${SCRIPT_DIR}/destroy-slot.sh" --slot "${slot}" --config "${config_path}" --env "${env_path}" >/dev/null 2>&1 || true
}

trap cleanup_slot EXIT INT TERM

while true; do
  cleanup_slot
  "${SCRIPT_DIR}/create-slot.sh" --slot "${slot}" --config "${config_path}" --env "${env_path}"
  guest_env_file="$(render_guest_runner_env "${env_path}")"

  log "uploading guest bootstrap assets for ${LUME_VM_NAME}"
  upload_guest_file "${REPO_ROOT}/scripts/lib/github-runner-common.sh" "${LUME_GUEST_HELPER_PATH}"
  upload_guest_file "${REPO_ROOT}/scripts/guest/macos-runner-bootstrap.sh" "${LUME_GUEST_BOOTSTRAP_PATH}"
  upload_env_file "${LUME_GUEST_ENV_PATH}" "${guest_env_file}"

  log "starting guest runner bootstrap for ${LUME_VM_NAME}"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 0 \
    "set -a && source '${LUME_GUEST_ENV_PATH}' && set +a && bash '${LUME_GUEST_BOOTSTRAP_PATH}'" \
    >> "${LUME_SLOT_LOG_FILE}" 2>&1 || true

  log "guest runner for ${LUME_VM_NAME} exited; recycling slot"
  cleanup_slot
  sleep 5
done
