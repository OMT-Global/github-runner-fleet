#!/usr/bin/env bash
# Prints one watchdog health line for the guest runner listener:
#   listener=<alive|absent> runner_file=<yes|no> diag_age=<seconds|na>
#
# A healthy long-polling listener refreshes _diag on every broker poll cycle;
# a zombie listener whose broker session died (for example after a cloned slot
# reused a consumed ephemeral session) stops writing entirely while the
# process stays online. diag_age is the age in seconds of the newest _diag
# log entry, or "na" when no diagnostics have been written yet.
set -u

listener=absent
# The bracket in [.] keeps the pattern from matching this probe's own process
# tree when it runs under `bash listener-health-probe.sh`.
if pgrep -f 'bin/Runner[.]Listener' >/dev/null 2>&1; then
  listener=alive
fi

runner_file=no
if [[ -n "${RUNNER_ROOT:-}" && -f "${RUNNER_ROOT}/.runner" ]]; then
  runner_file=yes
fi

diag_age=na
if [[ -n "${RUNNER_ROOT:-}" ]]; then
  newest="$(find "${RUNNER_ROOT}/_diag" -type f -name '*.log' -exec stat -f %m {} + 2>/dev/null | sort -rn | head -1)"
  if [[ -n "${newest}" ]]; then
    diag_age=$(( $(date +%s) - newest ))
  fi
fi

printf 'listener=%s runner_file=%s diag_age=%s\n' "${listener}" "${runner_file}" "${diag_age}"
