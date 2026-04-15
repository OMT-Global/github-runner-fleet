#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"
host_xcode_app="/Applications/Xcode.app"
stop_when_done="true"
base_vm_pid=""
base_vm_ip=""

wait_for_base_ssh() {
  local attempt

  for attempt in $(seq 1 60); do
    if lume ssh "${LUME_VM_BASE_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 10 "true" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  log "timed out waiting for SSH on ${LUME_VM_BASE_NAME}"
  return 1
}

cleanup() {
  if [[ -n "${base_vm_pid}" ]]; then
    kill "${base_vm_pid}" >/dev/null 2>&1 || true
    base_vm_pid=""
  fi

  if [[ "${stop_when_done}" == "true" ]] && [[ -n "${LUME_VM_BASE_NAME:-}" ]]; then
    lume stop "${LUME_VM_BASE_NAME}" $(storage_args) >/dev/null 2>&1 || true
  fi
}

base_ssh() {
  sshpass -p "${GUEST_PASSWORD}" ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    "${GUEST_USER}@${base_vm_ip}" \
    "$@"
}

trap cleanup EXIT INT TERM

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
    --host-xcode-app)
      host_xcode_app="$2"
      shift 2
      ;;
    --leave-running)
      stop_when_done="false"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

load_slot_env "1" "${config_path}" "${env_path}"

if [[ ! -d "${host_xcode_app}" ]]; then
  echo "host Xcode app ${host_xcode_app} does not exist" >&2
  exit 1
fi

for required_command in sshpass tar; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "required command ${required_command} is not installed" >&2
    exit 1
  fi
done

if ! lume get "${LUME_VM_BASE_NAME}" --format json $(storage_args) >/dev/null 2>&1; then
  echo "base VM ${LUME_VM_BASE_NAME} does not exist; create it first" >&2
  exit 1
fi

log "stopping base VM ${LUME_VM_BASE_NAME} before provisioning"
lume stop "${LUME_VM_BASE_NAME}" $(storage_args) >/dev/null 2>&1 || true

log "starting ${LUME_VM_BASE_NAME} for Xcode provisioning"
nohup lume run "${LUME_VM_BASE_NAME}" \
  --no-display \
  --network "${LUME_VM_NETWORK}" \
  $(storage_args) >/tmp/"${LUME_VM_BASE_NAME}".provision.log 2>&1 &
base_vm_pid="$!"

wait_for_base_ssh
log "base VM ${LUME_VM_BASE_NAME} is reachable over SSH"
base_vm_ip="$(
  lume get "${LUME_VM_BASE_NAME}" --format json $(storage_args) \
    | node --input-type=module -e 'let data="";process.stdin.on("data",(chunk)=>data+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(data);process.stdout.write(parsed[0]?.ipAddress ?? "");});'
)"

if [[ -z "${base_vm_ip}" ]]; then
  echo "failed to resolve IP for ${LUME_VM_BASE_NAME}" >&2
  exit 1
fi

host_xcode_name="$(basename "${host_xcode_app}")"
guest_xcode_archive="/Users/${GUEST_USER}/${host_xcode_name}.tar"

log "streaming ${host_xcode_app} into ${guest_xcode_archive} on ${LUME_VM_BASE_NAME}"
tar -C "$(dirname "${host_xcode_app}")" -cf - "${host_xcode_name}" \
  | base_ssh "cat > '${guest_xcode_archive}'"

base_ssh \
  "set -Eeuo pipefail
  printf '%s\n' '${GUEST_PASSWORD}' | sudo -S -p '' rm -rf '/Applications/${host_xcode_name}'
  printf '%s\n' '${GUEST_PASSWORD}' | sudo -S -p '' tar -xf '${guest_xcode_archive}' -C /Applications
  rm -f '${guest_xcode_archive}'
  printf '%s\n' '${GUEST_PASSWORD}' | sudo -S -p '' xcode-select -s '/Applications/${host_xcode_name}/Contents/Developer'
  printf '%s\n' '${GUEST_PASSWORD}' | sudo -S -p '' xcodebuild -license accept
  printf '%s\n' '${GUEST_PASSWORD}' | sudo -S -p '' xcodebuild -runFirstLaunch
  xcodebuild -version
  xcodebuild -showsdks
  "

cat <<EOF
Base VM ${LUME_VM_BASE_NAME} provisioned with host Xcode ${host_xcode_app}.
Next steps:
1. Start the pool with scripts/lume/reconcile-pool.sh.
2. Verify a slot runner registers with the xcode label.
3. Confirm queued macOS jobs start on the new runner.
EOF
