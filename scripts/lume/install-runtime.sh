#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Install a source-independent controller runtime for Lume launchd jobs.

Options:
  --target-home PATH  Home directory that owns the runtime (default: ${HOME})
  --target-user USER  User that should own the runtime after install
  --target-group GRP  Group that should own the runtime after install
  -h, --help          Show this help text

Environment:
  GITHUB_RUNNER_FLEET_RUNTIME_ROOT  Override the runtime root path
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "missing required command: ${command_name}" >&2
    exit 1
  fi
}

lume_controller_runtime_root() {
  local target_home="$1"

  if [[ -n "${GITHUB_RUNNER_FLEET_RUNTIME_ROOT:-}" ]]; then
    printf '%s\n' "${GITHUB_RUNNER_FLEET_RUNTIME_ROOT}"
    return 0
  fi

  printf '%s/Library/Application Support/github-runner-fleet/controller\n' "${target_home}"
}

lume_controller_runtime_repo() {
  local target_home="$1"
  printf '%s/current\n' "$(lume_controller_runtime_root "${target_home}")"
}

lume_controller_runtime_env() {
  local target_home="$1"
  printf '%s/.env\n' "$(lume_controller_runtime_root "${target_home}")"
}

write_default_runtime_env() {
  local env_path="$1"
  local target_home="$2"
  local lume_base_dir="${target_home}/Library/Application Support/github-runner-fleet/lume"
  local temp_path

  temp_path="$(mktemp)"
  cat > "${temp_path}" <<EOF
GITHUB_PAT=
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_API_URL=https://api.github.com
LUME_RUNNER_BASE_DIR='${lume_base_dir}'
LUME_RUNNER_ENV_FILE='${lume_base_dir}/runner.env'
COMPOSE_PROJECT_NAME=github-runner-fleet
RUNNER_VERSION=2.334.0
EOF
  install -m 0600 "${temp_path}" "${env_path}"
  rm -f "${temp_path}"
}

repair_default_runtime_env() {
  local env_path="$1"
  local target_home="$2"
  local unquoted_lume_base="${target_home}/Library/Application Support/github-runner-fleet/lume"

  if grep -qx 'GITHUB_PAT=' "${env_path}" \
    && grep -qx "LUME_RUNNER_BASE_DIR=${unquoted_lume_base}" "${env_path}"; then
    write_default_runtime_env "${env_path}" "${target_home}"
  fi
}

install_runtime_dependencies() {
  local runtime_repo="$1"
  local target_home="$2"
  local target_user="$3"
  local path_value="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${target_home}/.local/bin"

  if [[ -n "${target_user}" && "${EUID}" -eq 0 ]]; then
    require_command sudo
    sudo -u "${target_user}" \
      env HOME="${target_home}" PATH="${path_value}" \
      pnpm --dir "${runtime_repo}" install --frozen-lockfile
    return 0
  fi

  HOME="${target_home}" PATH="${path_value}" \
    pnpm --dir "${runtime_repo}" install --frozen-lockfile
}

install_lume_controller_runtime() {
  local target_home="${1:-${HOME}}"
  local target_user="${2:-}"
  local target_group="${3:-}"
  local runtime_root
  local runtime_repo
  local runtime_env

  require_command install
  require_command pnpm
  require_command rsync

  runtime_root="$(lume_controller_runtime_root "${target_home}")"
  runtime_repo="$(lume_controller_runtime_repo "${target_home}")"
  runtime_env="$(lume_controller_runtime_env "${target_home}")"

  mkdir -p "${runtime_root}" "${runtime_repo}"
  rsync -a --delete \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude '.pnpm-store/' \
    --exclude '.env' \
    "${REPO_ROOT}/" "${runtime_repo}/"

  if [[ -f "${runtime_env}" ]]; then
    repair_default_runtime_env "${runtime_env}" "${target_home}"
  elif [[ -f "${REPO_ROOT}/.env" ]]; then
    install -m 0600 "${REPO_ROOT}/.env" "${runtime_env}"
  else
    write_default_runtime_env "${runtime_env}" "${target_home}"
  fi

  if [[ -n "${target_user}" && -n "${target_group}" && "${EUID}" -eq 0 ]]; then
    chown -R "${target_user}:${target_group}" "${runtime_root}"
  fi

  install_runtime_dependencies "${runtime_repo}" "${target_home}" "${target_user}"

  if [[ -n "${target_user}" && -n "${target_group}" && "${EUID}" -eq 0 ]]; then
    chown -R "${target_user}:${target_group}" "${runtime_root}"
  fi

  printf 'runtime_root=%s\nruntime_repo=%s\nruntime_env=%s\n' \
    "${runtime_root}" "${runtime_repo}" "${runtime_env}"
}

main() {
  local target_home="${HOME}"
  local target_user=""
  local target_group=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        return 0
        ;;
      --target-home)
        target_home="$2"
        shift 2
        ;;
      --target-user)
        target_user="$2"
        shift 2
        ;;
      --target-group)
        target_group="$2"
        shift 2
        ;;
      *)
        usage >&2
        echo "unknown argument: $1" >&2
        return 1
        ;;
    esac
  done

  install_lume_controller_runtime "${target_home}" "${target_user}" "${target_group}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
