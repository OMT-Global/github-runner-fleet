#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-$(docker context show 2>/dev/null || true)}"
IMAGE_REF="${SMOKE_IMAGE_REF:-github-runner-fleet:smoke}"
KEEP_ARTIFACTS="${SMOKE_KEEP_ARTIFACTS:-0}"
TEMP_PARENT="${ROOT_DIR}/.tmp"
NETWORK="sgr-smoke-${RANDOM}${RANDOM}"
API_CONTAINER="sgr-smoke-api-${RANDOM}${RANDOM}"
RUNNER_CONTAINER="sgr-smoke-runner-${RANDOM}${RANDOM}"

mkdir -p "${TEMP_PARENT}"
TEMP_DIR="$(mktemp -d "${TEMP_PARENT}/smoke-test.XXXXXX")"
LOG_DIR="${TEMP_DIR}/logs"
ACTIONS_RUNNER_DIR="${TEMP_DIR}/actions-runner"

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

  docker_cmd rm -f "${RUNNER_CONTAINER}-runner" >/dev/null 2>&1 || true
  docker_cmd rm -f "${RUNNER_CONTAINER}-root" >/dev/null 2>&1 || true
  docker_cmd rm -f "${API_CONTAINER}" >/dev/null 2>&1 || true
  docker_cmd network rm "${NETWORK}" >/dev/null 2>&1 || true

  if [[ "${KEEP_ARTIFACTS}" == "1" ]]; then
    log "kept smoke artifacts at ${TEMP_DIR}"
  else
    if ! rm -rf "${TEMP_DIR}" 2>/dev/null; then
      docker_cmd run --rm \
        -v "${TEMP_DIR}:/cleanup" \
        alpine:3.22 \
        sh -lc 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true' \
        >/dev/null 2>&1 || true
      rm -rf "${TEMP_DIR}" >/dev/null 2>&1 || true
    fi
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

mkdir -p "${LOG_DIR}" "${ACTIONS_RUNNER_DIR}"
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

verify_python_toolcache() {
  log "verifying built-in Python tool cache"

  docker_cmd run --rm \
    --entrypoint /bin/bash \
    "${IMAGE_REF}" \
    -lc '
      set -Eeuo pipefail
      python_version="$(python3 -c "import platform; print(platform.python_version())")"
      case "$(uname -m)" in
        x86_64) python_arch="x64" ;;
        aarch64|arm64) python_arch="arm64" ;;
        *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
      esac
      python_cache_root="${RUNNER_TOOL_CACHE:-/opt/hostedtoolcache}/Python/${python_version}"

      test -L "${python_cache_root}/${python_arch}"
      test -f "${python_cache_root}/${python_arch}.complete"
      test "$(readlink -f "${python_cache_root}/${python_arch}")" = "/usr/local"
      python3.12 --version
      python --version
    '
}

verify_docker_cli() {
  log "verifying Docker CLI is present for the linux-docker plane"

  docker_cmd run --rm \
    --entrypoint /bin/bash \
    "${IMAGE_REF}" \
    -lc 'set -Eeuo pipefail && docker --version'
}

run_smoke_case() {
  local mode="$1"
  local state_dir="${TEMP_DIR}/state-${mode}"
  local runner_stdout="${TEMP_DIR}/runner.${mode}.stdout.log"
  local runner_name="smoke-runner-${mode}"

  rm -rf "${state_dir}"
  mkdir -p "${state_dir}"

  log "running runner image smoke flow (${mode})"

  local -a env_args=(
    -e GITHUB_PAT=fake-pat
    -e GITHUB_API_URL=http://mock-api:8080
    -e GITHUB_ORG=test-org
    -e RUNNER_NAME="${runner_name}"
    -e RUNNER_GROUP=synology-private
    -e RUNNER_LABELS=synology,shell-only,private
    -e RUNNER_ALLOWED_REPOSITORIES=test-org/private-app
    -e RUNNER_STATE_DIR=/tmp/runner-state
    -e RUNNER_LOG_DIR=/tmp/runner-state/logs
    -e RUNNER_WORK_DIR=/tmp/runner-state/_work
  )

  if [[ "${mode}" == "root" ]]; then
    env_args+=(-e RUNNER_EXEC_MODE_OVERRIDE=root)
  fi

  docker_cmd run --rm \
    --name "${RUNNER_CONTAINER}-${mode}" \
    --network "${NETWORK}" \
    "${env_args[@]}" \
    -v "${state_dir}:/tmp/runner-state" \
    -v "${ACTIONS_RUNNER_DIR}:/actions-runner:ro" \
    "${IMAGE_REF}" | tee "${runner_stdout}"

  grep -q "POST /orgs/test-org/actions/runners/registration-token" "${LOG_DIR}/mock-api.log"
  grep -q "POST /orgs/test-org/actions/runners/remove-token" "${LOG_DIR}/mock-api.log"
  grep -q -- "--runnergroup synology-private --ephemeral --disableupdate" "${state_dir}/config-invocations.log"
  grep -q "config path: /tmp/runner-state/runner-home" "${state_dir}/config-context.log"
  grep -q "run path: /tmp/runner-state/runner-home" "${state_dir}/run-context.log"
  grep -q "runner writable home: /tmp/runner-state/runner-home" "${runner_stdout}"
  grep -q "^job output$" "${state_dir}/logs/runner.log"
  grep -q "run.sh stub executed" "${state_dir}/run.log"
  grep -q "runner registration removed cleanly" "${runner_stdout}"

  if [[ "${mode}" == "root" ]]; then
    grep -q "runner execution mode override: root" "${runner_stdout}"
    grep -q "runner execution mode: root fallback" "${runner_stdout}"
    grep -q "config mode: root" "${state_dir}/config-context.log"
    grep -q "run mode: root" "${state_dir}/run-context.log"
  else
    grep -q "runner execution mode: runner user" "${runner_stdout}"
    grep -q "config mode: runner" "${state_dir}/config-context.log"
    grep -q "run mode: runner" "${state_dir}/run-context.log"
  fi
}

run_smoke_case runner
run_smoke_case root
verify_python_toolcache
verify_docker_cli

log "smoke test passed"
log "image=${IMAGE_REF}"
log "context=${DOCKER_CONTEXT:-default}"
