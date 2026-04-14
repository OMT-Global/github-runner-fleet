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
    log "remove token request failed; leaving GitHub runner registration in place for manual cleanup"
    return 0
  fi

  if [[ -z "${remove_token}" ]]; then
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

  if declare -F cleanup_local_state >/dev/null 2>&1; then
    cleanup_local_state
  fi

  log "runner registration removed cleanly"
}
