#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"
ipsw="latest"
unattended="$(default_lume_unattended_path)"

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
    --ipsw)
      ipsw="$2"
      shift 2
      ;;
    --unattended)
      unattended="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

load_slot_env "1" "${config_path}" "${env_path}"

if lume get "${LUME_VM_BASE_NAME}" --format json $(storage_args) >/dev/null 2>&1; then
  echo "base VM ${LUME_VM_BASE_NAME} already exists" >&2
  exit 1
fi

if [[ "${ipsw}" == "latest" ]]; then
  ipsw="$(ensure_cached_lume_ipsw "$(resolve_lume_ipsw_path)")"
fi

log "creating base VM ${LUME_VM_BASE_NAME}"
lume create "${LUME_VM_BASE_NAME}" \
  --os macOS \
  --ipsw "${ipsw}" \
  --cpu "${LUME_VM_CPU}" \
  --memory "${LUME_VM_MEMORY}" \
  --disk-size "${LUME_VM_DISK_SIZE}" \
  --network "${LUME_VM_NETWORK}" \
  --unattended "${unattended}" \
  --no-display \
  $(storage_args)

cat <<EOF
Base VM ${LUME_VM_BASE_NAME} created.
IPSW cache: ${ipsw}
Next steps:
1. If unattended setup did not complete, rerun scripts/lume/setup-base-vm.sh.
2. Boot it and install Xcode/toolchain prerequisites.
3. Verify the default guest user (${GUEST_USER}) can run CI workloads.
4. Shut it down cleanly.
5. Start the pool with scripts/lume/reconcile-pool.sh.
EOF
