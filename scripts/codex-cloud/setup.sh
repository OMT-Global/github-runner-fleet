    #!/usr/bin/env bash
    set -euo pipefail

    if [[ -f package-lock.json ]]; then
  npm ci --prefer-offline --no-audit --no-fund
elif [[ -f pnpm-lock.yaml ]]; then
  corepack enable
  pnpm install --frozen-lockfile
elif [[ -f yarn.lock ]]; then
  corepack enable
  yarn install --immutable
elif [[ -f package.json ]]; then
  npm install --prefer-offline --no-audit --no-fund
fi

if [[ -f pyproject.toml ]]; then
  python3 -m venv .venv
  source .venv/bin/activate
  python -m pip install --upgrade pip setuptools wheel
  python -m pip install -e ".[dev]" >/dev/null 2>&1 || python -m pip install -e . >/dev/null 2>&1 || true
fi
