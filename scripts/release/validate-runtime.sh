#!/usr/bin/env bash
set -euo pipefail

subject="${1:?usage: validate-runtime.sh <image@sha256:digest>}"
if [[ ! "${subject}" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "runtime validation requires an immutable image digest" >&2
  exit 1
fi

for platform in linux/amd64 linux/arm64; do
  echo "validating release runtime ${subject} (${platform})"
  docker run --rm --platform "${platform}" --entrypoint /bin/bash "${subject}" -lc '
    set -euo pipefail
    test "$(cd /actions-runner && ./bin/Runner.Listener --version)" = "$(cat /.runner-version)"
    command -v pgrep
    pgrep --version
    docker --version
    node --version
    python3 --version
    terraform version
  '
done
