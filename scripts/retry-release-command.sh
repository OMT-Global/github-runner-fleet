#!/usr/bin/env bash
# Retry signing services only; preserve each attempt and the final failure.
set -euo pipefail
log_dir="${RELEASE_LOG_DIR:-/tmp/runner-release}"
mkdir -p "$log_dir"
name="$1"
shift
[[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
for attempt in 1 2 3; do
  if timeout 5m "$@" >"$log_dir/$name-$attempt.log" 2>&1; then
    cat "$log_dir/$name-$attempt.log"
    exit 0
  else
    status=$?
    cat "$log_dir/$name-$attempt.log" >&2
    if [[ "$attempt" == 3 ]]; then exit "$status"; fi
    sleep "$((attempt * 10))"
  fi
done
