#!/usr/bin/env bash
# Source this file from CI scripts before invoking pnpm. The shell-only
# self-hosted runners cannot rely on Corepack writing shims into the Node
# install directory, so keep the pnpm shim in a job-writable path.
set -euo pipefail

corepack_bin_dir="${COREPACK_BIN_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/corepack-bin}"
mkdir -p "${corepack_bin_dir}"
corepack enable --install-directory "${corepack_bin_dir}"
export PATH="${corepack_bin_dir}:${PATH}"
corepack prepare pnpm@10.32.1 --activate
