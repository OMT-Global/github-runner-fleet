#!/usr/bin/env bash
set -euo pipefail

log_file="${RUNNER_STATE_DIR}/config-invocations.log"
mkdir -p "$(dirname "${log_file}")"
printf '%s %s\n' "$(date -Iseconds)" "$*" >> "${log_file}"
printf 'config path: %s\n' "$(pwd)" >> "${RUNNER_STATE_DIR}/config-context.log"
printf 'config mode: %s\n' "${RUNNER_EXECUTION_MODE:-unknown}" >> "${RUNNER_STATE_DIR}/config-context.log"

if [[ "${1:-}" == "remove" ]]; then
  exit 0
fi

touch .runner .credentials .credentials_rsaparams
