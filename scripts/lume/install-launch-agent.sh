#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

LAUNCH_AGENT_LABEL="com.omt.github-runner-fleet.lume-pool"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/github-runner-fleet"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LAUNCH_AGENT_LABEL}.plist"
STDOUT_PATH="${LOG_DIR}/lume-pool.stdout.log"
STDERR_PATH="${LOG_DIR}/lume-pool.stderr.log"
DOMAIN_TARGET="gui/$(id -u)"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Install and kickstart the per-user launch agent that reconciles the Lume pool.

This script writes:
  ${PLIST_PATH}
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "missing required command: ${command_name}" >&2
    exit 1
  fi
}

write_plist() {
  local rtk_path="$1"
  local temp_path

  temp_path="$(mktemp)"
  cat > "${temp_path}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${rtk_path}</string>
    <string>bash</string>
    <string>-lc</string>
    <string>cd '${REPO_ROOT}' &amp;&amp; exec bash scripts/lume/reconcile-pool.sh --config config/lume-runners.yaml --env .env</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${STDOUT_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.local/bin</string>
  </dict>
</dict>
</plist>
EOF

  plutil -lint "${temp_path}" >/dev/null
  mv "${temp_path}" "${PLIST_PATH}"
}

main() {
  local rtk_path

  if [[ $# -gt 0 ]]; then
    case "$1" in
      -h|--help)
        usage
        return 0
        ;;
      *)
        usage >&2
        echo "unknown argument: $1" >&2
        return 1
        ;;
    esac
  fi

  require_command launchctl
  require_command plutil
  require_command rtk

  rtk_path="$(command -v rtk)"

  mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}"
  write_plist "${rtk_path}"

  launchctl bootout "${DOMAIN_TARGET}" "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl bootstrap "${DOMAIN_TARGET}" "${PLIST_PATH}"
  launchctl enable "${DOMAIN_TARGET}/${LAUNCH_AGENT_LABEL}"
  launchctl kickstart -k "${DOMAIN_TARGET}/${LAUNCH_AGENT_LABEL}"

  printf 'installed %s at %s\n' "${LAUNCH_AGENT_LABEL}" "${PLIST_PATH}"
  launchctl print "${DOMAIN_TARGET}/${LAUNCH_AGENT_LABEL}" | sed -n '1,120p'
}

main "$@"
