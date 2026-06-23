#!/usr/bin/env bash
set -euo pipefail

printf '%s run.sh stub executed\n' "$(date -Iseconds)" >> "${RUNNER_STATE_DIR}/run.log"
printf 'run path: %s\n' "$(pwd)" >> "${RUNNER_STATE_DIR}/run-context.log"
printf 'run mode: %s\n' "${RUNNER_EXECUTION_MODE:-unknown}" >> "${RUNNER_STATE_DIR}/run-context.log"
for credential_name in GITHUB_PAT GITHUB_TOKEN GH_TOKEN GITHUB_APP_ID GITHUB_APP_INSTALLATION_ID GITHUB_APP_PRIVATE_KEY; do
  if [[ -n "${!credential_name:-}" ]]; then
    printf 'leaked credential: %s\n' "${credential_name}" >> "${RUNNER_STATE_DIR}/run-context.log"
    exit 1
  fi
done
printf 'github auth: unset\n' >> "${RUNNER_STATE_DIR}/run-context.log"
printf 'process github auth: unset\n' >> "${RUNNER_STATE_DIR}/run-context.log"
mkdir -p "${RUNNER_WORK_DIR}/workspace"
touch "${RUNNER_WORK_DIR}/workspace/job.txt"
echo "job output"
