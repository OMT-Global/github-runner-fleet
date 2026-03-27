#!/usr/bin/env bash
set -euo pipefail

printf '%s run.sh stub executed\n' "$(date -Iseconds)" >> "${RUNNER_STATE_DIR}/run.log"
mkdir -p "${RUNNER_WORK_DIR}/workspace"
touch "${RUNNER_WORK_DIR}/workspace/job.txt"
echo "job output"
