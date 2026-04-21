#!/usr/bin/env bash

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log "missing required environment variable: ${name}"
    exit 1
  fi
}

runner_audit_id() {
  local runner_file=""

  if [[ -n "${RUNNER_HOME:-}" && -f "${RUNNER_HOME}/.runner" ]]; then
    runner_file="${RUNNER_HOME}/.runner"
  elif [[ -n "${RUNNER_ROOT:-}" && -f "${RUNNER_ROOT}/.runner" ]]; then
    runner_file="${RUNNER_ROOT}/.runner"
  fi

  if [[ -z "${runner_file}" ]]; then
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    jq -r '.agentId // .id // empty' "${runner_file}" 2>/dev/null
    return
  fi

  python3 - "${runner_file}" <<'PY' 2>/dev/null || true
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)
value = payload.get("agentId", payload.get("id", ""))
if value != "":
    print(value)
PY
}

audit_event() {
  local event="$1"
  local runner_id
  runner_id="$(runner_audit_id)"

  if ! python3 - "${event}" "${runner_id}" <<'PY'; then
import datetime
import json
import os
import pathlib
import sys

event = sys.argv[1]
runner_id = sys.argv[2]
path = pathlib.Path(os.environ.get("AUDIT_LOG_FILE") or "/var/log/runner-fleet/audit.jsonl")
max_size_raw = os.environ.get("AUDIT_LOG_MAX_SIZE_BYTES", "").strip()
max_size = int(max_size_raw) if max_size_raw else None
record = {
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "event": event,
    "runner_name": os.environ.get("RUNNER_NAME", "unknown"),
    "pool": os.environ.get("FLEET_POOL_KEY") or os.environ.get("RUNNER_GROUP", "unknown"),
    "plane": os.environ.get("FLEET_PLANE", "unknown"),
    "org": os.environ.get("GITHUB_ORG", "unknown"),
}
if runner_id:
    try:
        record["runner_id"] = int(runner_id)
    except ValueError:
        record["runner_id"] = runner_id
container_id = os.environ.get("CONTAINER_ID") or os.environ.get("HOSTNAME", "")
if container_id:
    record["container_id"] = container_id
line = json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n"
path.parent.mkdir(parents=True, exist_ok=True)
if max_size is not None and path.exists() and path.stat().st_size + len(line.encode("utf-8")) > max_size:
    rotated = path.with_name(path.name + ".1")
    try:
        rotated.unlink()
    except FileNotFoundError:
        pass
    path.replace(rotated)
with path.open("a", encoding="utf-8") as handle:
    handle.write(line)
    handle.flush()
    os.fsync(handle.fileno())
PY
    log "audit event ${event} could not be written to ${AUDIT_LOG_FILE:-/var/log/runner-fleet/audit.jsonl}"
  fi
}

extract_json_token() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.token // empty'
    return
  fi

  python3 -c 'import json,sys; print(json.load(sys.stdin).get("token", ""))'
}

github_runner_endpoint_base() {
  if [[ -n "${GITHUB_REPO:-}" ]]; then
    printf '/repos/%s/actions/runners' "${GITHUB_REPO}"
    return
  fi

  printf '/orgs/%s/actions/runners' "${GITHUB_ORG}"
}

github_api_post() {
  local endpoint="$1"
  local tmp status body

  tmp="$(mktemp)"
  status="$(
    curl -sS \
      -o "${tmp}" \
      -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${GITHUB_PAT}" \
      -H "Accept: application/vnd.github+json" \
      -H "User-Agent: github-runner-fleet" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "${GITHUB_API_URL%/}${endpoint}"
  )"
  body="$(cat "${tmp}")"
  rm -f "${tmp}"

  if [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    log "GitHub API POST ${endpoint} failed with ${status}: ${body}"
    return 1
  fi

  printf '%s' "${body}"
}

request_runner_token() {
  local kind="$1"
  local endpoint_base

  endpoint_base="$(github_runner_endpoint_base)"

  case "${kind}" in
    registration)
      github_api_post "${endpoint_base}/registration-token" | extract_json_token
      ;;
    remove)
      github_api_post "${endpoint_base}/remove-token" | extract_json_token
      ;;
    *)
      log "unsupported token kind: ${kind}"
      return 1
      ;;
  esac
}

cleanup_runner_registration() {
  local remove_command="$1"
  local configured="${RUNNER_CONFIGURED:-${runner_configured:-false}}"

  if [[ "${configured}" != "true" ]]; then
    return 0
  fi

  log "requesting remove token for ${RUNNER_NAME}"
  local remove_token
  if ! remove_token="$(request_runner_token remove)"; then
    audit_event token_fetch_failed
    log "remove token request failed; leaving GitHub runner registration in place for manual cleanup"
    return 0
  fi

  if [[ -z "${remove_token}" ]]; then
    audit_event token_fetch_failed
    log "remove token response was empty; leaving GitHub runner registration in place for manual cleanup"
    return 0
  fi

  export RUNNER_REMOVE_TOKEN="${remove_token}"
  if ! eval "${remove_command}"; then
    unset RUNNER_REMOVE_TOKEN
    log "runner removal command failed; check GitHub runner inventory for stale registrations"
    return 0
  fi
  unset RUNNER_REMOVE_TOKEN

  audit_event "${RUNNER_AUDIT_DEREGISTER_EVENT:-runner_deregistered}"

  if declare -F cleanup_local_state >/dev/null 2>&1; then
    cleanup_local_state
  fi

  log "runner registration removed cleanly"
}
