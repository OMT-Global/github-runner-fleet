# Private-Repo Parity And Runner Routing

This guide answers a simple question for downstream repos:

Which jobs should run on the current self-hosted fleet, and which jobs still need GitHub-hosted runners?

The intent is to let private repos move as much CI as possible onto your own capacity without weakening the shell-only Synology boundary.

## Current Runner Classes

| Runner class | Labels | Best for | Keep off this class |
| --- | --- | --- | --- |
| Synology shell-only | `self-hosted`, `synology`, `shell-only`, `private` or `public` | bash/docs jobs, JS actions, Node validation, Python `3.12`, Terraform CLI, lightweight smoke checks | `container:` jobs, service containers, Docker daemon/Buildx, Kind, Playwright, browser-heavy lanes, distro-package-heavy Linux setup |
| GitHub-hosted fallback | `ubuntu-latest`, `macos-latest`, or other hosted images | incompatible workloads, public fork PRs, and jobs that still depend on GitHub-hosted image breadth | steady-state private-repo workloads that already fit the shell-safe runner contract |

## Current Parity Gaps

The biggest current gaps between GitHub-hosted Linux runners and this fleet are:

- Docker-capable Linux workloads:
  `container:` jobs, service containers, Docker daemon flows, Buildx, Kind, and many browser/integration suites still need hosted Linux today.
- Broad Linux image/tooling coverage:
  the Synology plane intentionally carries a narrow shell-safe toolchain instead of the full GitHub-hosted image catalog.
- Hosted image convenience:
  GitHub-hosted runners still win for jobs that assume large preinstalled toolchains or broad distro package availability.

The planned answer for the biggest remaining gap is tracked in [#34](https://github.com/OMT-Global/github-runner-fleet/issues/34): a separate ephemeral Linux runner plane for Docker-capable workloads.

## Routing Rules

Use these rules in order:

1. If a job fits the shell-safe contract, run it on Synology.
2. If a job needs Docker semantics, `container:`, service containers, Kind, Playwright-with-deps, or heavier Linux system setup, keep it on GitHub-hosted until the Docker-capable Linux plane lands.
3. If the workflow runs for an untrusted public fork PR, keep it on GitHub-hosted unless the lane has been explicitly designed for that trust boundary.

## Job-Class Matrix

| Job pattern | Recommended placement | Notes |
| --- | --- | --- |
| `pnpm lint`, `pnpm test`, docs validation, shell scripts | Synology shell-only | Prefer the repo's shell-safe Node setup action where needed |
| Python `3.12` lint/test | Synology shell-only | Route non-`3.12` matrix lanes elsewhere |
| Terraform validate/plan without Docker sidecars | Synology shell-only | Keep plugin cache under runner temp |
| `container:` jobs | GitHub-hosted for now | Planned self-hosted target: issue [#34](https://github.com/OMT-Global/github-runner-fleet/issues/34) |
| `services:` jobs | GitHub-hosted for now | Same gap as container workloads |
| Docker build/push, Buildx, QEMU | GitHub-hosted for now | Do not weaken Synology shell-only to absorb this |
| Kind/Kubernetes integration tests | GitHub-hosted for now | Treat as Docker-capable Linux work |
| Playwright or browser installs with heavy OS deps | GitHub-hosted for now | Move only after a Linux Docker-capable runner class exists |
| Public fork PR smoke checks | GitHub-hosted | Avoid accidental secrets or trust drift |

## Example `runs-on` Contracts

Private shell-safe repos:

```yaml
runs-on: [self-hosted, synology, shell-only, private]
```

Public shell-safe repos:

```yaml
runs-on: [self-hosted, synology, shell-only, public]
```

GitHub-hosted fallback for currently incompatible Linux jobs:

```yaml
runs-on: ubuntu-latest
```

## Migration Checklist For A Private Repo

1. Split the workflow by workload type instead of trying to move everything at once.
2. Move shell-safe Node, Python `3.12`, Terraform, and docs lanes to Synology first.
3. Leave Docker/container/service/browser-heavy lanes on GitHub-hosted until issue [#34](https://github.com/OMT-Global/github-runner-fleet/issues/34) lands.
4. Add or update custom labels in any downstream actionlint config so workflow linting understands the self-hosted labels you use.
5. Keep hosted fallback explicit rather than silently routing incompatible jobs onto shell-only runners.

## Decision Shortcut

If a job can run in bash with the baked-in shell-safe toolchain, prefer Synology.

If it needs Docker semantics or a much broader Linux image, keep it on GitHub-hosted until the Docker-capable Linux plane exists.
