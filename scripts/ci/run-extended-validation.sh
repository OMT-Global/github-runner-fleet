#!/usr/bin/env bash
# Deeper local validation: everything in run-fast-checks.sh plus the
# coverage-threshold gate.
#
# Mutation testing is intentionally NOT run here. It remains a separate
# CI job ("Mutation Tests" in .github/workflows/extended-validation.yml)
# because it is far slower than the coverage gate and uploads its own
# report artifact; running it inline would blow the extended-checks
# timeout budget on the self-hosted Synology runner.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

bash scripts/ci/run-fast-checks.sh
pnpm test:coverage
