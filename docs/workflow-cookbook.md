# Shell-safe workflow cookbook

This guide is for downstream repositories that want to consume the runner contracts from this repo without guessing which jobs belong on self-hosted Synology runners, which jobs belong on the Lume macOS pool, and which jobs should stay on GitHub-hosted runners.

## Runner compatibility matrix

| Job class | Synology shell-only pool | Lume macOS pool | GitHub-hosted runners | Notes |
| --- | --- | --- | --- | --- |
| Node install, lint, test, build | Yes | Usually unnecessary | Yes | On Synology, use `OMT-Global/synology-github-runner/actions/setup-shell-safe-node` instead of `actions/setup-node`. |
| Python 3.12 lint/test | Yes | Optional | Yes | `actions/setup-python@v6` with `python-version: '3.12'` resolves locally on the Synology image. Other Python versions should stay hosted unless you control the full toolchain. |
| Terraform fmt/validate/init without cloud sidecars | Yes | Optional | Yes | Keep plugin cache under `RUNNER_TEMP` or another writable container-local path. |
| Docs checks, markdown lint, shell validation | Yes | Optional | Yes | Good fit for the shell-only pool when the job only needs baked-in CLI tools. |
| Release image builds, Buildx, QEMU, registry publish | No | No | Yes | Keep these on GitHub-hosted runners. |
| Docker daemon, `docker build`, `docker compose`, service containers | No | No | Yes | The Synology runner class intentionally avoids Docker socket mounts and does not support service containers. |
| `container:` jobs | No | No | Yes | Route these back to GitHub-hosted runners. |
| Browser/UI/E2E jobs needing extra distro packages | No | Sometimes | Yes | Prefer hosted runners unless the macOS requirement is explicit and owned. |
| macOS signing, Xcode builds, Swift/macOS validation | No | Yes | Yes | Use the Lume pool when you need a self-hosted macOS environment. |
| Public fork pull requests | No | No | Yes | Keep fork PRs on GitHub-hosted runners so untrusted code does not land on self-hosted infrastructure. |

## Routing rules

Use these rules when deciding where a workflow job should run:

- Use `runs-on: [self-hosted, synology, shell-only, public]` for trusted shell-safe jobs that can run with the baked-in Linux toolchain.
- Use `runs-on: [self-hosted, macos, arm64]` only when you intentionally target the Lume macOS pool and control the repo trust boundary.
- Keep pull requests from forks on GitHub-hosted runners.
- Keep any workflow using `container:`, `services:`, browsers, Docker daemon access, Buildx, or extra distro package assumptions on GitHub-hosted runners.
- Prefer a split workflow over forcing one runner class to handle incompatible jobs.

## Recipe: trusted Node job on the Synology shell-only pool

Use this when the repo is trusted and the job only needs Node plus standard shell tooling.

```yaml
name: shell-safe node ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test_trusted:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on:
      - self-hosted
      - synology
      - shell-only
      - public
    env:
      RUNNER_TEMP: /tmp/github-runner-temp
      RUNNER_TOOL_CACHE: /opt/hostedtoolcache
      AGENT_TOOLSDIRECTORY: /opt/hostedtoolcache
    steps:
      - uses: actions/checkout@v6
      - run: mkdir -p "$RUNNER_TEMP" "$RUNNER_TOOL_CACHE"
      - uses: pnpm/action-setup@v5
        with:
          version: 10.32.1
      - uses: OMT-Global/synology-github-runner/actions/setup-shell-safe-node@main
        with:
          node-version: 24.14.1
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
```

Why this pattern exists:

- `actions/setup-node` can fail on the shell-only Synology pool when extracting archives onto restrictive mounts.
- The bundled setup action stays within the runner's supported contract.

## Recipe: trusted jobs on self-hosted, fork PRs on GitHub-hosted

This is the default split when a repo wants self-hosted speed for trusted code but safe isolation for public forks.

```yaml
name: split trust ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test_self_hosted_trusted:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on:
      - self-hosted
      - synology
      - shell-only
      - public
    env:
      RUNNER_TEMP: /tmp/github-runner-temp
      RUNNER_TOOL_CACHE: /opt/hostedtoolcache
      AGENT_TOOLSDIRECTORY: /opt/hostedtoolcache
    steps:
      - uses: actions/checkout@v6
      - run: mkdir -p "$RUNNER_TEMP" "$RUNNER_TOOL_CACHE"
      - uses: pnpm/action-setup@v5
        with:
          version: 10.32.1
      - uses: OMT-Global/synology-github-runner/actions/setup-shell-safe-node@main
        with:
          node-version: 24.14.1
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test

  test_public_fork_pr:
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v5
        with:
          version: 10.32.1
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
```

Use this pattern whenever the repository is public or accepts outside contributions.

## Recipe: Python 3.12 on the Synology shell-only pool

Use this when the job only needs the built-in Python toolchain shipped in the runner image.

```yaml
jobs:
  python312_trusted:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on:
      - self-hosted
      - synology
      - shell-only
      - public
    env:
      RUNNER_TEMP: /tmp/github-runner-temp
      RUNNER_TOOL_CACHE: /opt/hostedtoolcache
      AGENT_TOOLSDIRECTORY: /opt/hostedtoolcache
    steps:
      - uses: actions/checkout@v6
      - run: mkdir -p "$RUNNER_TEMP" "$RUNNER_TOOL_CACHE"
      - uses: actions/setup-python@v6
        with:
          python-version: '3.12'
      - run: python --version
      - run: python -m pip install -r requirements-dev.txt
      - run: pytest
```

Boundary condition:

- If you need Python 3.11, 3.13, or a matrix across versions, keep those lanes on GitHub-hosted runners unless you intentionally build and own a wider self-hosted contract.

## Recipe: Terraform validation on the Synology shell-only pool

```yaml
jobs:
  terraform_validate_trusted:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on:
      - self-hosted
      - synology
      - shell-only
      - public
    env:
      RUNNER_TEMP: /tmp/github-runner-temp
      TF_PLUGIN_CACHE_DIR: /tmp/github-runner-temp/terraform-plugin-cache
    steps:
      - uses: actions/checkout@v6
      - run: mkdir -p "$RUNNER_TEMP" "$TF_PLUGIN_CACHE_DIR"
      - run: terraform fmt -check
      - run: terraform init -backend=false
      - run: terraform validate
```

This works well for pure CLI Terraform jobs. If the workflow also builds containers, talks to Docker, or needs sidecar services, split those parts back to GitHub-hosted runners.

## Recipe: Lume macOS contract job

Use the Lume pool for self-hosted macOS work such as Swift validation, Xcode-dependent checks, or other tasks that explicitly need a macOS guest.

```yaml
jobs:
  macos_trusted:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on:
      - self-hosted
      - macos
      - arm64
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v5
        with:
          version: 10.32.1
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: swift --version
```

Use the hosted `macos-latest` image instead when the repository does not need self-hosted state or when you want GitHub-managed isolation for untrusted code.

## Force jobs back to GitHub-hosted runners when

- the workflow uses `container:`
- the workflow uses `services:`
- the job requires Docker daemon access, Buildx, or QEMU
- the job needs browsers or large sets of distro packages not already present in the runner contract
- the change comes from a public fork or another untrusted source
- the job depends on a language/version combination outside the documented self-hosted contract
