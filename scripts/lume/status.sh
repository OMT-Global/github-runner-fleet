#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"
format="text"

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
    --format)
      format="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${format}" != "text" && "${format}" != "json" ]]; then
  echo "--format must be text or json" >&2
  exit 1
fi

pool_size="$(load_pool_size "${config_path}" "${env_path}")"
load_slot_env "1" "${config_path}" "${env_path}"
base_vm_name="${LUME_VM_BASE_NAME}"
base_vm_status="missing"
if base_vm_exists; then
  base_vm_status="present"
fi

if [[ "${format}" == "json" ]]; then
  printf '{\n'
  printf '  "poolSize": %s,\n' "${pool_size}"
  printf '  "baseVm": {"name": "%s", "status": "%s"},\n' "${base_vm_name}" "${base_vm_status}"
  printf '  "slots": [\n'
else
  printf 'base_vm=%s status=%s\n' "${base_vm_name}" "${base_vm_status}"
fi

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

  if [[ "${format}" == "json" ]]; then
    printf '    {"slot": %s, "vmName": "%s", "worker": "%s", "vm": "%s", "log": "%s", "vmLog": "%s"}' \
      "${slot}" \
      "${LUME_VM_NAME}" \
      "${worker_status}" \
      "${vm_status}" \
      "${LUME_SLOT_LOG_FILE}" \
      "${LUME_SLOT_VM_LOG_FILE}"
    if [[ "${slot}" != "${pool_size}" ]]; then
      printf ','
    fi
    printf '\n'
    continue
  fi

  printf '%s worker=%s vm=%s log=%s vm_log=%s\n' \
    "${LUME_VM_NAME}" \
    "${worker_status}" \
    "${vm_status}" \
    "${LUME_SLOT_LOG_FILE}" \
    "${LUME_SLOT_VM_LOG_FILE}"
done

if [[ "${format}" == "json" ]]; then
  printf '  ]\n}\n'
fi
