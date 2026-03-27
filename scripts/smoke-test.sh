#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-$(docker context show 2>/dev/null || true)}"
IMAGE_REF="${SMOKE_IMAGE_REF:-synology-github-runner:smoke}"
KEEP_ARTIFACTS="${SMOKE_KEEP_ARTIFACTS:-0}"
TEMP_PARENT="${ROOT_DIR}/.tmp"
NETWORK="sgr-smoke-${RANDOM}${RANDOM}"
API_CONTAINER="sgr-smoke-api-${RANDOM}${RANDOM}"
RUNNER_CONTAINER="sgr-smoke-runner-${RANDOM}${RANDOM}"

mkdir -p "${TEMP_PARENT}"
TEMP_DIR="$(mktemp -d "${TEMP_PARENT}/smoke-test.XXXXXX")"
STATE_DIR="${TEMP_DIR}/state"
LOG_DIR="${TEMP_DIR}/logs"
ACTIONS_RUNNER_DIR="${TEMP_DIR}/actions-runner"
RUNNER_STDOUT="${TEMP_DIR}/runner.stdout.log"

docker_cmd() {
  if [[ -n "${DOCKER_CONTEXT}" ]]; then
    docker --context "${DOCKER_CONTEXT}" "$@"
  else
    docker "$@"
  fi
}

log() {
  printf '[smoke-test] %s\n' "$*"
}

cleanup() {
  local exit_code=$?

  docker_cmd rm -f "${RUNNER_CONTAINER}" >/dev/null 2>&1 || true
  docker_cmd rm -f "${API_CONTAINER}" >/dev/null 2>&1 || true
  docker_cmd network rm "${NETWORK}" >/dev/null 2>&1 || true

  if [[ "${KEEP_ARTIFACTS}" == "1" ]]; then
    log "kept smoke artifacts at ${TEMP_DIR}"
  else
    rm -rf "${TEMP_DIR}"
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

default_platform() {
  local machine
  machine="$(uname -m)"
  case "${machine}" in
    arm64|aarch64)
      printf 'linux/arm64'
      ;;
    x86_64|amd64)
      printf 'linux/amd64'
      ;;
    *)
      printf 'linux/arm64'
      ;;
  esac
}

SMOKE_PLATFORM="${SMOKE_PLATFORM:-$(default_platform)}"

mkdir -p "${STATE_DIR}" "${LOG_DIR}" "${ACTIONS_RUNNER_DIR}"
cp "${ROOT_DIR}/scripts/smoke/actions-runner/config.sh" "${ACTIONS_RUNNER_DIR}/config.sh"
cp "${ROOT_DIR}/scripts/smoke/actions-runner/run.sh" "${ACTIONS_RUNNER_DIR}/run.sh"
chmod +x "${ACTIONS_RUNNER_DIR}/config.sh" "${ACTIONS_RUNNER_DIR}/run.sh"

log "building ${IMAGE_REF} for ${SMOKE_PLATFORM}"
DOCKER_CONTEXT="${DOCKER_CONTEXT}" "${ROOT_DIR}/scripts/build-image.sh" "${IMAGE_REF}" --platform "${SMOKE_PLATFORM}"

log "creating smoke network ${NETWORK}"
docker_cmd network create "${NETWORK}" >/dev/null

log "starting mock token API"
docker_cmd run -d --rm \
  --name "${API_CONTAINER}" \
  --network "${NETWORK}" \
  --network-alias mock-api \
  -e MOCK_LOG_PATH=/logs/mock-api.log \
  -v "${ROOT_DIR}/scripts/smoke/mock-api.mjs:/app/mock-api.mjs:ro" \
  -v "${LOG_DIR}:/logs" \
  node:24-alpine \
  node /app/mock-api.mjs >/dev/null

for _ in $(seq 1 20); do
  if [[ -f "${LOG_DIR}/mock-api.log" ]] && grep -q "listening 0.0.0.0:8080" "${LOG_DIR}/mock-api.log"; then
    break
  fi
  sleep 0.5
done

if [[ ! -f "${LOG_DIR}/mock-api.log" ]] || ! grep -q "listening 0.0.0.0:8080" "${LOG_DIR}/mock-api.log"; then
  log "mock token API did not become ready"
  exit 1
fi

log "running runner image smoke flow"
docker_cmd run --rm \
  --name "${RUNNER_CONTAINER}" \
  --network "${NETWORK}" \
  -e GITHUB_PAT=fake-pat \
  -e GITHUB_API_URL=http://mock-api:8080 \
  -e GITHUB_ORG=test-org \
  -e RUNNER_NAME=smoke-runner-01 \
  -e RUNNER_GROUP=synology-private \
  -e RUNNER_LABELS=synology,shell-only,private \
  -e RUNNER_ALLOWED_REPOSITORIES=test-org/private-app \
  -e RUNNER_STATE_DIR=/tmp/runner-state \
  -e RUNNER_LOG_DIR=/tmp/runner-state/logs \
  -e RUNNER_WORK_DIR=/tmp/runner-state/_work \
  -v "${STATE_DIR}:/tmp/runner-state" \
  -v "${ACTIONS_RUNNER_DIR}:/actions-runner" \
  "${IMAGE_REF}" | tee "${RUNNER_STDOUT}"

grep -q "POST /orgs/test-org/actions/runners/registration-token" "${LOG_DIR}/mock-api.log"
grep -q "POST /orgs/test-org/actions/runners/remove-token" "${LOG_DIR}/mock-api.log"
grep -q -- "--runnergroup synology-private --ephemeral --disableupdate" "${STATE_DIR}/config-invocations.log"
grep -q "^job output$" "${STATE_DIR}/logs/runner.log"
grep -q "run.sh stub executed" "${STATE_DIR}/run.log"
grep -q "runner registration removed cleanly" "${RUNNER_STDOUT}"

log "smoke test passed"
log "image=${IMAGE_REF}"
log "context=${DOCKER_CONTEXT:-default}"
