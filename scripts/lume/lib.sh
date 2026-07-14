#!/usr/bin/env bash
set -Eeuo pipefail

LUME_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LUME_LIB_DIR}/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/github-runner-common.sh"

default_lume_config_path() {
  printf '%s/config/lume-runners.yaml' "${REPO_ROOT}"
}

default_lume_env_path() {
  printf '%s/.env' "${REPO_ROOT}"
}

default_lume_unattended_path() {
  printf '%s/scripts/lume/unattended-sequoia.yml' "${REPO_ROOT}"
}

default_guest_runner_path() {
  printf '%s\n' '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.local/bin'
}

load_slot_env() {
  local slot="$1"
  local config_path="$2"
  local env_path="$3"

  pushd "${REPO_ROOT}" >/dev/null
  eval "$(
    pnpm exec tsx src/cli.ts render-lume-runner-manifest \
      --config "${config_path}" \
      --env "${env_path}" \
      --slot "${slot}" \
      --format shell
  )"
  popd >/dev/null
}

latest_ipsw_url() {
  lume ipsw | tail -n 1
}

resolve_lume_ipsw_path() {
  if [[ -n "${LUME_HOST_IPSW_PATH:-}" ]]; then
    printf '%s\n' "${LUME_HOST_IPSW_PATH}"
    return 0
  fi

  local ipsw_url
  ipsw_url="$(latest_ipsw_url)"
  printf '%s/cache/%s\n' "${LUME_HOST_BASE_DIR}" "$(basename "${ipsw_url}")"
}

ensure_cached_lume_ipsw() {
  local target_path="$1"
  local ipsw_url
  local partial_path

  mkdir -p "$(dirname "${target_path}")"
  if [[ -s "${target_path}" ]]; then
    log "reusing cached IPSW ${target_path}"
    printf '%s\n' "${target_path}"
    return 0
  fi

  ipsw_url="$(latest_ipsw_url)"
  partial_path="${target_path}.partial"
  log "downloading IPSW ${ipsw_url} -> ${target_path}"
  curl -fL --continue-at - \
    --connect-timeout "${LUME_DOWNLOAD_CONNECT_TIMEOUT_SECONDS:-15}" \
    --max-time "${LUME_DOWNLOAD_MAX_TIME_SECONDS:-7200}" \
    --retry 3 --retry-all-errors --retry-delay 5 \
    --output "${partial_path}" "${ipsw_url}"
  mv "${partial_path}" "${target_path}"
  printf '%s\n' "${target_path}"
}

load_pool_size() {
  local config_path="$1"
  local env_path="$2"

  pushd "${REPO_ROOT}" >/dev/null
  pnpm exec tsx src/cli.ts validate-lume-config \
    --config "${config_path}" \
    --env "${env_path}" \
    | node --input-type=module -e 'let data="";process.stdin.on("data",(chunk)=>data+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(data);process.stdout.write(String(parsed.pool.size));});'
  popd >/dev/null
}

storage_args() {
  if [[ -n "${LUME_VM_STORAGE:-}" ]]; then
    printf '%s\n' "--storage" "${LUME_VM_STORAGE}"
  fi
}

clone_args() {
  if [[ -n "${LUME_VM_STORAGE:-}" ]]; then
    printf '%s\n' "--source-storage" "${LUME_VM_STORAGE}" "--dest-storage" "${LUME_VM_STORAGE}"
  fi
}

wait_for_ssh() {
  local attempt
  local ssh_output
  local ssh_exit

  for attempt in $(seq 1 60); do
    # Use 'if' to suppress set -e so a failed SSH attempt does not abort the loop.
    if ssh_output="$(lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 10 "true" 2>&1)"; then
      return 0
    fi
    ssh_exit=$?
    log "wait_for_ssh attempt ${attempt}/60: exit=${ssh_exit} output=[${ssh_output}]"
    sleep 5
  done

  log "timed out waiting for SSH on ${LUME_VM_NAME}"
  return 1
}

upload_guest_file() {
  local source_path="$1"
  local destination_path="$2"
  local content

  content="$(base64 < "${source_path}" | tr -d '\n')"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout "${LUME_SSH_TIMEOUT_SECONDS:-60}" \
    "mkdir -p '$(dirname "${destination_path}")' && printf '%s' '${content}' | base64 -D > '${destination_path}' && chmod 0755 '${destination_path}'"
}

upload_env_file() {
  local destination_path="$1"
  local source_path="${2:-${LUME_HOST_ENV_FILE}}"
  local content

  content="$(base64 < "${source_path}" | tr -d '\n')"
  lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout "${LUME_SSH_TIMEOUT_SECONDS:-60}" \
    "mkdir -p '$(dirname "${destination_path}")' && printf '%s' '${content}' | base64 -D > '${destination_path}' && chmod 0600 '${destination_path}'"
}

render_guest_runner_env() {
  local env_path="$1"
  local temp_env
  local runner_download_url="${RUNNER_DOWNLOAD_URL:-}"
  local runner_group="${RUNNER_GROUP}"
  local runner_labels="${RUNNER_LABELS}"
  local runner_name="${RUNNER_NAME}"
  local runner_path
  local runner_root="${RUNNER_ROOT}"
  local runner_version="${RUNNER_VERSION}"
  local runner_work_dir="${RUNNER_WORK_DIR}"

  temp_env="$(mktemp)"
  runner_path="${RUNNER_PATH:-$(default_guest_runner_path)}"
  (
    set -a
    # shellcheck disable=SC1090
    source "${env_path}"
    set +a

    cat <<EOF
GITHUB_PAT=${GITHUB_PAT}
GITHUB_APP_ID=${GITHUB_APP_ID:-}
GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID:-}
GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY:-}
GITHUB_API_URL=${GITHUB_API_URL}
GITHUB_REPO=${GITHUB_REPO:-}
GITHUB_ORG=${GITHUB_ORG}
RUNNER_GROUP=${runner_group}
RUNNER_LABELS=${runner_labels}
RUNNER_NAME=${runner_name}
RUNNER_ROOT=${runner_root}
RUNNER_WORK_DIR=${runner_work_dir}
RUNNER_PATH=${runner_path}
RUNNER_VERSION=${runner_version}
RUNNER_DOWNLOAD_URL=${runner_download_url}
AUDIT_LOG_FILE=${runner_root}/audit.jsonl
EOF
  ) > "${temp_env}"

  printf '%s\n' "${temp_env}"
}

collect_guest_audit() {
  local guest_path="$1"
  local host_path="$2"
  local temp_file
  temp_file="$(mktemp)"
  if ! lume ssh "${LUME_VM_NAME}" --user "${GUEST_USER}" --password "${GUEST_PASSWORD}" --timeout 30 \
    "test ! -f '${guest_path}' || cat '${guest_path}'" > "${temp_file}" 2>/dev/null; then
    rm -f "${temp_file}"
    log "failed to collect guest audit log from ${LUME_VM_NAME}"
    return 0
  fi

  python3 - "${temp_file}" "${host_path}" <<'PY'
import fcntl
import json
import os
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
target.parent.mkdir(parents=True, exist_ok=True)
records = []
for line in source.read_text(encoding="utf-8").splitlines():
    try:
        records.append(json.dumps(json.loads(line), separators=(",", ":"), sort_keys=True) + "\n")
    except json.JSONDecodeError:
        continue
if not records:
    raise SystemExit(0)
lock_path = target.with_name(target.name + ".lock")
with lock_path.open("a", encoding="utf-8") as lock:
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
    payload = "".join(records)
    max_size = 10 * 1024 * 1024
    if target.exists() and target.stat().st_size + len(payload.encode("utf-8")) > max_size:
        rotated = target.with_name(target.name + ".1")
        try:
            rotated.unlink()
        except FileNotFoundError:
            pass
        target.replace(rotated)
    with target.open("a", encoding="utf-8") as output:
        output.write(payload)
        output.flush()
        os.fsync(output.fileno())
PY
  rm -f "${temp_file}"
}

vm_exists() {
  lume get "${LUME_VM_NAME}" --format json $(storage_args) >/dev/null 2>&1
}

spawn_detached() {
  local log_path="$1"
  shift

  python3 - "${log_path}" "$@" <<'PY'
import os
import sys

log_path = sys.argv[1]
command = sys.argv[2:]

pid = os.fork()
if pid:
    print(pid)
    sys.exit(0)

os.setsid()

stdin_fd = os.open("/dev/null", os.O_RDONLY)
log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)

os.dup2(stdin_fd, 0)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)

os.close(stdin_fd)
os.close(log_fd)

os.execvp(command[0], command)
PY
}

terminate_tracked_process() {
  local pid_file="$1"
  local expected_command="$2"
  local timeout_seconds="${3:-10}"
  local pid command deadline kill_deadline

  [[ -f "${pid_file}" ]] || return 0
  pid="$(<"${pid_file}")"
  if [[ ! "${pid}" =~ ^[1-9][0-9]*$ ]]; then
    log "refusing to signal invalid pid from ${pid_file}: ${pid}"
    return 1
  fi
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    rm -f "${pid_file}"
    return 0
  fi

  command="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if [[ "${command}" != *"${expected_command}"* ]]; then
    log "refusing to signal pid ${pid} from ${pid_file}; expected ${expected_command}, found ${command:-unknown}"
    return 1
  fi

  kill -TERM "${pid}"
  deadline=$((SECONDS + timeout_seconds))
  while kill -0 "${pid}" >/dev/null 2>&1 && (( SECONDS < deadline )); do
    sleep 0.1
  done
  if kill -0 "${pid}" >/dev/null 2>&1; then
    log "pid ${pid} did not stop within ${timeout_seconds}s; sending SIGKILL"
    kill -KILL "${pid}"
    kill_deadline=$((SECONDS + 2))
    while kill -0 "${pid}" >/dev/null 2>&1 && (( SECONDS < kill_deadline )); do
      sleep 0.1
    done
  fi
  if kill -0 "${pid}" >/dev/null 2>&1; then
    log "pid ${pid} remained alive after SIGKILL"
    return 1
  fi
  rm -f "${pid_file}"
}
