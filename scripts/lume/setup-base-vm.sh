#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

config_path="$(default_lume_config_path)"
env_path="$(default_lume_env_path)"
unattended="$(default_lume_unattended_path)"
debug="false"
debug_dir=""

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
    --unattended)
      unattended="$2"
      shift 2
      ;;
    --debug)
      debug="true"
      shift
      ;;
    --debug-dir)
      debug_dir="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

load_slot_env "1" "${config_path}" "${env_path}"

if ! lume get "${LUME_VM_BASE_NAME}" --format json $(storage_args) >/dev/null 2>&1; then
  echo "base VM ${LUME_VM_BASE_NAME} does not exist; create it first" >&2
  exit 1
fi

log "stopping base VM ${LUME_VM_BASE_NAME} before unattended setup"
lume stop "${LUME_VM_BASE_NAME}" $(storage_args) >/dev/null 2>&1 || true

setup_args=(
  setup
  "${LUME_VM_BASE_NAME}"
  --unattended "${unattended}"
  --no-display
)

if [[ "${debug}" == "true" ]]; then
  setup_args+=(--debug)
fi

if [[ -n "${debug_dir}" ]]; then
  setup_args+=(--debug-dir "${debug_dir}")
fi

while IFS= read -r arg; do
  setup_args+=("${arg}")
done < <(storage_args)

log "running unattended setup for ${LUME_VM_BASE_NAME}"
lume "${setup_args[@]}"

cat <<EOF
Base VM ${LUME_VM_BASE_NAME} completed unattended setup.
Next steps:
1. Boot it and install Xcode/toolchain prerequisites.
2. Verify the default guest user (${GUEST_USER}) can run CI workloads.
3. Shut it down cleanly.
4. Start the pool with scripts/lume/reconcile-pool.sh.
EOF
