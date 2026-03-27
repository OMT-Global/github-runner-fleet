#!/usr/bin/env bash
set -euo pipefail

log_file="${RUNNER_STATE_DIR}/config-invocations.log"
mkdir -p "$(dirname "${log_file}")"
printf '%s %s\n' "$(date -Iseconds)" "$*" >> "${log_file}"

if [[ "${1:-}" == "remove" ]]; then
  exit 0
fi

touch .runner .credentials .credentials_rsaparams
