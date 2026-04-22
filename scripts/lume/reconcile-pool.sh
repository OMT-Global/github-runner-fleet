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

retire_removed_slots_from_state() {
  local state_file="$1"
  local current_pool_size="$2"
  local removed_slots

  if [[ ! -f "${state_file}" ]]; then
    return 0
  fi

  if ! removed_slots="$(STATE_FILE="${state_file}" POOL_SIZE="${current_pool_size}" node --input-type=module <<'NODE'
import fs from "node:fs";

try {
  const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE, "utf8"));
  const poolSize = Number(process.env.POOL_SIZE);
  for (const slot of state.slots ?? []) {
    if (Number(slot.index) > poolSize) {
      console.log([
        slot.index,
        slot.workerPidFile ?? "",
        slot.vmName ?? "",
        slot.vmPidFile ?? "",
        slot.vmStorage ?? "",
        slot.hostDir ?? ""
      ].join("\t"));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
NODE
  )"; then
    log "ignoring unreadable reconciliation state ${state_file}"
    return 0
  fi

  while IFS=$'\t' read -r slot_index worker_pid_file vm_name vm_pid_file vm_storage host_dir; do
    if [[ -z "${slot_index}" ]]; then
      continue
    fi

    log "retiring removed slot ${slot_index} (${vm_name}) from persisted reconciliation state"
    if [[ -n "${worker_pid_file}" && -f "${worker_pid_file}" ]]; then
      local worker_pid
      worker_pid="$(cat "${worker_pid_file}")"
      kill "${worker_pid}" >/dev/null 2>&1 || true
      rm -f "${worker_pid_file}"
    fi

    local state_storage_args=()
    if [[ -n "${vm_storage}" ]]; then
      state_storage_args=(--storage "${vm_storage}")
    fi

    if [[ -n "${vm_name}" ]] && lume get "${vm_name}" --format json "${state_storage_args[@]}" >/dev/null 2>&1; then
      lume stop "${vm_name}" "${state_storage_args[@]}" >/dev/null 2>&1 || true
      sleep 2
      lume delete "${vm_name}" --force "${state_storage_args[@]}" >/dev/null 2>&1 || true
    fi

    if [[ -n "${vm_pid_file}" && -f "${vm_pid_file}" ]]; then
      kill "$(cat "${vm_pid_file}")" >/dev/null 2>&1 || true
      rm -f "${vm_pid_file}"
    fi

    if [[ -n "${host_dir}" ]]; then
      rm -rf "${host_dir}"
    fi
  done <<< "${removed_slots}"
}

write_slot_state_record() {
  local record_file="$1"
  local worker_pid=""
  local worker_status="stopped"

  if [[ -f "${LUME_SLOT_WORKER_PID_FILE}" ]]; then
    worker_pid="$(cat "${LUME_SLOT_WORKER_PID_FILE}")"
    if kill -0 "${worker_pid}" >/dev/null 2>&1; then
      worker_status="running"
    else
      worker_status="stale"
    fi
  fi

  RECORD_FILE="${record_file}" WORKER_PID="${worker_pid}" WORKER_STATUS="${worker_status}" node --input-type=module <<'NODE'
import fs from "node:fs";

const workerPid = process.env.WORKER_PID ? Number(process.env.WORKER_PID) : undefined;
const slot = {
  index: Number(process.env.LUME_SLOT_INDEX),
  slotKey: process.env.LUME_SLOT_KEY,
  vmName: process.env.LUME_VM_NAME,
  vmStorage: process.env.LUME_VM_STORAGE || undefined,
  runnerName: process.env.RUNNER_NAME,
  hostDir: process.env.LUME_SLOT_DIR,
  workerPidFile: process.env.LUME_SLOT_WORKER_PID_FILE,
  vmPidFile: process.env.LUME_SLOT_VM_PID_FILE,
  workerLogFile: process.env.LUME_SLOT_LOG_FILE,
  vmLogFile: process.env.LUME_SLOT_VM_LOG_FILE,
  workerPid,
  workerStatus: process.env.WORKER_STATUS
};

fs.appendFileSync(process.env.RECORD_FILE, `${JSON.stringify(slot)}\n`, "utf8");
NODE
}

write_reconcile_state() {
  local state_file="$1"
  local record_file="$2"
  local state_dir
  state_dir="$(dirname "${state_file}")"
  mkdir -p "${state_dir}"

  STATE_FILE="${state_file}" RECORD_FILE="${record_file}" RECORDED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" node --input-type=module <<'NODE'
import fs from "node:fs";

const records = fs.existsSync(process.env.RECORD_FILE)
  ? fs.readFileSync(process.env.RECORD_FILE, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const state = {
  version: 1,
  recordedAt: process.env.RECORDED_AT,
  pool: {
    key: process.env.LUME_POOL_KEY,
    size: Number(process.env.LUME_POOL_SIZE),
    vmBaseName: process.env.LUME_VM_BASE_NAME,
    vmSlotPrefix: process.env.LUME_VM_SLOT_PREFIX
  },
  slots: records
};
const tempFile = `${process.env.STATE_FILE}.tmp`;
fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
fs.renameSync(tempFile, process.env.STATE_FILE);
NODE
}

pool_size="$(load_pool_size "${config_path}" "${env_path}")"
load_slot_env "1" "${config_path}" "${env_path}"
reconcile_state_file="${LUME_RECONCILE_STATE_FILE}"
mkdir -p "$(dirname "${reconcile_state_file}")"
retire_removed_slots_from_state "${reconcile_state_file}" "${pool_size}"

log "reconciling Lume runner pool with ${pool_size} slots"

while true; do
  state_records_file="$(mktemp)"
  for slot in $(seq 1 "${pool_size}"); do
    load_slot_env "${slot}" "${config_path}" "${env_path}"
    mkdir -p "${LUME_SLOT_DIR}" "$(dirname "${LUME_SLOT_LOG_FILE}")"

    if [[ -f "${LUME_SLOT_WORKER_PID_FILE}" ]] && kill -0 "$(cat "${LUME_SLOT_WORKER_PID_FILE}")" >/dev/null 2>&1; then
      write_slot_state_record "${state_records_file}"
      continue
    fi

    log "starting slot worker ${slot} (${LUME_VM_NAME})"
    nohup "${SCRIPT_DIR}/run-slot.sh" --slot "${slot}" --config "${config_path}" --env "${env_path}" \
      >> "${LUME_SLOT_LOG_FILE}" 2>&1 &
    echo $! > "${LUME_SLOT_WORKER_PID_FILE}"
    write_slot_state_record "${state_records_file}"
  done

  write_reconcile_state "${reconcile_state_file}" "${state_records_file}"
  rm -f "${state_records_file}"
  sleep 15
done
