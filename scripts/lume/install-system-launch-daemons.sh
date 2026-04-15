#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

TARGET_USER="${SUDO_USER:-$(stat -f '%Su' /dev/console)}"
TARGET_HOME="$(dscl . -read "/Users/${TARGET_USER}" NFSHomeDirectory | awk '{print $2}')"
TARGET_GROUP="$(id -gn "${TARGET_USER}")"
LUME_LABEL="com.omt.github-runner-fleet.lume-serve"
POOL_LABEL="com.omt.github-runner-fleet.lume-pool.system"
DAEMON_DIR="/Library/LaunchDaemons"
LOG_DIR="${TARGET_HOME}/Library/Logs/github-runner-fleet"
LUME_PLIST_PATH="${DAEMON_DIR}/${LUME_LABEL}.plist"
POOL_PLIST_PATH="${DAEMON_DIR}/${POOL_LABEL}.plist"
USER_LUME_AGENT_PATH="${TARGET_HOME}/Library/LaunchAgents/com.trycua.lume_daemon.plist"
DISABLE_USER_LUME_AGENT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --disable-user-lume-agent)
      DISABLE_USER_LUME_AGENT="true"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "missing required command: ${command_name}" >&2
    exit 1
  fi
}

write_root_owned_plist() {
  local destination_path="$1"
  local temp_path="$2"

  plutil -lint "${temp_path}" >/dev/null
  install -o root -g wheel -m 0644 "${temp_path}" "${destination_path}"
}

write_lume_plist() {
  local lume_path="$1"
  local temp_path

  temp_path="$(mktemp)"
  cat > "${temp_path}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LUME_LABEL}</string>
  <key>UserName</key>
  <string>${TARGET_USER}</string>
  <key>GroupName</key>
  <string>${TARGET_GROUP}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${lume_path}</string>
    <string>serve</string>
    <string>--port</string>
    <string>7777</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${TARGET_HOME}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/lume-serve.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/lume-serve.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${TARGET_HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${TARGET_HOME}/.local/bin</string>
  </dict>
</dict>
</plist>
EOF

  write_root_owned_plist "${LUME_PLIST_PATH}" "${temp_path}"
  rm -f "${temp_path}"
}

write_pool_plist() {
  local rtk_path="$1"
  local temp_path

  temp_path="$(mktemp)"
  cat > "${temp_path}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${POOL_LABEL}</string>
  <key>UserName</key>
  <string>${TARGET_USER}</string>
  <key>GroupName</key>
  <string>${TARGET_GROUP}</string>
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
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/lume-pool.system.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/lume-pool.system.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${TARGET_HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${TARGET_HOME}/.local/bin</string>
  </dict>
</dict>
</plist>
EOF

  write_root_owned_plist "${POOL_PLIST_PATH}" "${temp_path}"
  rm -f "${temp_path}"
}

disable_user_lume_agent() {
  local uid

  uid="$(id -u "${TARGET_USER}")"
  if [[ "${DISABLE_USER_LUME_AGENT}" != "true" ]] || [[ ! -f "${USER_LUME_AGENT_PATH}" ]]; then
    return 0
  fi

  launchctl bootout "gui/${uid}" "${USER_LUME_AGENT_PATH}" >/dev/null 2>&1 || true
  launchctl disable "gui/${uid}/com.trycua.lume_daemon" >/dev/null 2>&1 || true
}

bootstrap_daemon() {
  local label="$1"
  local plist_path="$2"

  launchctl bootout system "${plist_path}" >/dev/null 2>&1 || true
  launchctl bootstrap system "${plist_path}"
  launchctl enable "system/${label}"
  launchctl kickstart -k "system/${label}"
}

main() {
  local lume_path
  local rtk_path

  require_command dscl
  require_command id
  require_command install
  require_command launchctl
  require_command plutil
  require_command stat
  require_command rtk

  lume_path="${TARGET_HOME}/.local/bin/lume"
  rtk_path="$(command -v rtk)"

  if [[ ! -x "${lume_path}" ]]; then
    echo "missing Lume binary: ${lume_path}" >&2
    exit 1
  fi

  mkdir -p "${DAEMON_DIR}" "${LOG_DIR}"
  chown "${TARGET_USER}:${TARGET_GROUP}" "${LOG_DIR}"

  write_lume_plist "${lume_path}"
  write_pool_plist "${rtk_path}"
  disable_user_lume_agent
  bootstrap_daemon "${LUME_LABEL}" "${LUME_PLIST_PATH}"
  bootstrap_daemon "${POOL_LABEL}" "${POOL_PLIST_PATH}"

  printf 'installed %s at %s\n' "${LUME_LABEL}" "${LUME_PLIST_PATH}"
  printf 'installed %s at %s\n' "${POOL_LABEL}" "${POOL_PLIST_PATH}"
  launchctl print "system/${LUME_LABEL}" | sed -n '1,120p'
  launchctl print "system/${POOL_LABEL}" | sed -n '1,120p'
}

main "$@"
