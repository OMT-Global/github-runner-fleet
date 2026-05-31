#!/usr/bin/env bash
# Cheap local CI gate: lint, unit tests, and build.
#
# Heavier validation (coverage thresholds, mutation testing) lives in
# scripts/ci/run-extended-validation.sh and the Extended Validation
# workflow. Keep this script shell-safe for self-hosted shell-safe
# runners: no sudo, no extra package installs, only the built-in
# Node/Corepack toolchain.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

corepack enable
corepack prepare pnpm@10.32.1 --activate

pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
