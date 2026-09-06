#!/usr/bin/env bash
set -euo pipefail

log_name="${1:?usage: retry.sh <log-name> <command> [arguments...]}"
shift
if [[ ! "${log_name}" =~ ^[a-zA-Z0-9_-]+$ || $# -eq 0 ]]; then
  echo "a safe log name and command are required" >&2
  exit 1
fi
log_dir="${RELEASE_LOG_DIR:-/tmp/runner-release}"
mkdir -p "${log_dir}"

for attempt in 1 2 3; do
  attempt_log="${log_dir}/${log_name}-attempt-${attempt}.log"
  echo "${log_name}: attempt ${attempt}/3 (two-minute limit)"
  if timeout 2m "$@" >"${attempt_log}" 2>&1; then
    cat "${attempt_log}"
    exit 0
  else
    status=$?
  fi
  cat "${attempt_log}" >&2
  echo "${log_name}: attempt ${attempt} failed with exit ${status}" >&2

  # Retry the observed Rekor transport failure and other transient network/server
  # failures. Invalid signatures, identities, and predicates fail immediately.
  if [[ "${status}" -ne 124 ]] && ! grep -Eiq 'giving up after [0-9]+ attempt|connection reset|TLS handshake timeout|context deadline exceeded|i/o timeout|temporary failure|connection refused|service unavailable|unexpected status.*(429|50[0-9])' "${attempt_log}"; then
    exit "${status}"
  fi
  if [[ "${attempt}" -eq 3 ]]; then
    echo "${log_name}: retry limit reached; see preserved attempt logs" >&2
    exit "${status}"
  fi
  sleep "$((attempt * 5))"
done
