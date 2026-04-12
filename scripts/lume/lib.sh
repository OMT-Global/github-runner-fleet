#!/usr/bin/env bash
set -Eeuo pipefail

LUME_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LUME_LIB_DIR}/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/github-runner-common.sh"

default_lume_config_path() {
  printf '%s/config/lume-runners.yaml' "${REPO_ROOT}"
}

default_lume_env_path() {
  printf '%s/.env' "${REPO_ROOT}"
}

load_slot_env() {
  local slot="$1"
  local config_path="$2"
  local env_path="$3"

  pushd "${REPO_ROOT}" >/dev/null
  eval "$(
    pnpm exec tsx src/cli.ts render-lume-runner-manifest \
      --config "${config_path}" \
      --env "${env_path}" \
      --slot "${slot}" \
      --format shell
  )"
  popd >/dev/null
}

load_pool_size() {
  local config_path="$1"
  local env_path="$2"

  pushd "${REPO_ROOT}" >/dev/null
  pnpm exec tsx src/cli.ts validate-lume-config \
    --config "${config_path}" \
    --env "${env_path}" \
    | node --input-type=module -e 'let data="";process.stdin.on("data",(chunk)=>data+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(data);process.stdout.write(String(parsed.pool.size));});'
  popd >/dev/null
}

storage_args() {
  if [[ -n "${LUME_VM_STORAGE:-}" ]]; then
    printf '%s\n' "--storage" "${LUME_VM_STORAGE}"
  fi
}

clone_args() {
  if [[ -n "${LUME_VM_STORAGE:-}" ]]; then
    printf '%s\n' "--source-storage" "${LUME_VM_STORAGE}" "--dest-storage" "${LUME_VM_STORAGE}"
  fi
}

wait_for_ssh() {
  local attempt

  for attempt in $(seq 1 60); do
    if lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 10 "true" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  log "timed out waiting for SSH on ${LUME_VM_NAME}"
  return 1
}

upload_guest_file() {
  local source_path="$1"
  local destination_path="$2"
  local content

  content="$(base64 < "${source_path}" | tr -d '\n')"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 0 \
    "mkdir -p '$(dirname "${destination_path}")' && printf '%s' '${content}' | base64 -D > '${destination_path}' && chmod 0755 '${destination_path}'"
}

upload_env_file() {
  local destination_path="$1"
  local content

  content="$(base64 < "${LUME_HOST_ENV_FILE}" | tr -d '\n')"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 0 \
    "mkdir -p '$(dirname "${destination_path}")' && printf '%s' '${content}' | base64 -D > '${destination_path}' && chmod 0600 '${destination_path}'"
}

vm_exists() {
  lume get "${LUME_VM_NAME}" --format json $(storage_args) >/dev/null 2>&1
}

base_vm_exists() {
  lume get "${LUME_VM_BASE_NAME}" --format json $(storage_args) >/dev/null 2>&1
}
