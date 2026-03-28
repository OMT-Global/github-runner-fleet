#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

IMAGE_REF="${1:-}"
if [[ -z "${IMAGE_REF}" ]]; then
  echo "usage: scripts/build-image.sh <image-ref> [--platform linux/arm64|linux/amd64|linux/amd64,linux/arm64] [--push]" >&2
  exit 1
fi

shift

DEFAULT_PLATFORM="linux/arm64"
PUBLISH_PLATFORM="linux/amd64,linux/arm64"
PLATFORM="${DEFAULT_PLATFORM}"
PUSH_FLAG=""
PLATFORM_WAS_SET=0
LOAD_FLAG="--load"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="${2:?missing value for --platform}"
      PLATFORM_WAS_SET=1
      shift 2
      ;;
    --push)
      PUSH_FLAG="--push"
      shift
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 1
      ;;
  esac
done

: "${RUNNER_VERSION:=2.333.0}"
: "${NODE_VERSION:=18.20.8}"
: "${TERRAFORM_VERSION:=1.6.6}"

if [[ -n "${PUSH_FLAG}" && "${PLATFORM_WAS_SET}" -eq 0 ]]; then
  PLATFORM="${PUBLISH_PLATFORM}"
fi

if [[ -n "${PUSH_FLAG}" ]]; then
  LOAD_FLAG=""
elif [[ "${PLATFORM}" == *,* ]]; then
  echo "multi-platform builds require --push; local non-pushed builds must target a single platform" >&2
  exit 1
fi

cd "${ROOT_DIR}"

docker buildx build \
  --platform "${PLATFORM}" \
  --build-arg "RUNNER_VERSION=${RUNNER_VERSION}" \
  --build-arg "NODE_VERSION=${NODE_VERSION}" \
  --build-arg "TERRAFORM_VERSION=${TERRAFORM_VERSION}" \
  -f docker/Dockerfile \
  -t "${IMAGE_REF}" \
  ${LOAD_FLAG:+"${LOAD_FLAG}"} \
  ${PUSH_FLAG:+"${PUSH_FLAG}"} \
  .
