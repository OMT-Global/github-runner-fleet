# Private-Repo Parity And Runner Routing

This guide answers two operator questions:

1. Where should a given GitHub Actions job run?
2. What still needs GitHub-hosted runners after the self-hosted planes are in place?

Use it alongside `pnpm doctor`, the main [README](../README.md), and the open backlog for gaps that are still intentionally unresolved.

## Current Runner Classes

| Runner class | Default labels | Best for | Keep off this class |
| --- | --- | --- | --- |
| Synology shell-only | `self-hosted`, `synology`, `shell-only`, `private` or `public` | bash/docs jobs, JS actions, Node validation, Python `3.12`, Terraform CLI, lightweight smoke checks | `container:` jobs, service containers, Docker daemon/Buildx, Kind, Playwright, browser-heavy lanes, distro-package-heavy setup |
| Linux Docker | `self-hosted`, `linux`, `docker-capable`, `private` | `container:` jobs, service containers, Docker daemon workflows, Buildx, Kind, heavier Linux integration | untrusted public fork PRs, macOS-native lanes, snowflake long-lived hosts |
| Lume macOS | `self-hosted`, `macos`, `arm64`, `private`, plus pool-specific labels like `xcode` | Xcode builds, Swift tests, macOS-native tooling, host-accurate Apple platform lanes | Linux container workloads, Docker-focused Linux integration, long-lived hand-managed VMs |
| GitHub-hosted fallback | `ubuntu-latest`, `macos-latest`, or other hosted images | incompatible workloads, public fork PRs, and anything that still depends on GitHub-hosted image breadth | steady-state private-repo workloads that already fit one of the self-hosted classes |

## Current Parity Gaps

These are the main places where GitHub-hosted runners still have broader surface area than the current fleet:

- Broad Linux image/tooling coverage:
  even with the Linux Docker plane, GitHub-hosted runners still win when you need the full hosted image catalog without curating your own host baseline.
- Self-hosted operator ergonomics:
  the repo is adding better doctor/status surfaces, but GitHub-hosted still wins on out-of-the-box visibility.
- Public fork trust boundaries:
  keep untrusted PRs on GitHub-hosted runners unless a workflow has been designed very deliberately for that exposure model.

## Routing Rules

Use these rules in order:

1. If a job needs a real macOS host, run it on Lume.
2. If a job fits the shell-safe contract, run it on Synology.
3. If a job needs Docker, `container:`, service containers, Kind, Playwright-with-deps, or heavier Linux system setup, run it on the Linux Docker plane.
4. If the workflow runs for an untrusted public fork PR, keep it on GitHub-hosted unless the lane has been explicitly designed for that trust boundary.

## Job-Class Matrix

| Job pattern | Recommended placement | Notes |
| --- | --- | --- |
| `pnpm lint`, `pnpm test`, docs validation, shell scripts | Synology shell-only | Prefer the repo's shell-safe Node setup action where needed |
| Python `3.12` lint/test | Synology shell-only | Route non-`3.12` matrix lanes elsewhere |
| Terraform validate/plan without Docker sidecars | Synology shell-only | Keep plugin cache under runner temp |
| Xcode build/test, SwiftPM macOS tooling | Lume macOS | Keep labels explicit, for example `xcode` |
| `container:` jobs | Linux Docker | Use `runs-on: [self-hosted, linux, docker-capable, private]` |
| `services:` jobs | Linux Docker | Same contract as other Docker-capable Linux work |
| Docker build/push, Buildx, QEMU | Linux Docker | Keep the Docker socket on the dedicated Linux host, not Synology |
| Kind/Kubernetes integration tests | Linux Docker | Treat as Docker-capable Linux work |
| Playwright or browser installs with heavy OS deps | Linux Docker or GitHub-hosted | Prefer GitHub-hosted when image breadth matters more than self-hosting |
| Public fork PR smoke checks | GitHub-hosted | Avoid accidental secrets/trust drift |

## Example `runs-on` Contracts

Private shell-safe repos:

```yaml
runs-on: [self-hosted, synology, shell-only, private]
```

Public shell-safe repos:

```yaml
runs-on: [self-hosted, synology, shell-only, public]
```

macOS-native lanes:

```yaml
runs-on: [self-hosted, macos, arm64, xcode]
```

Docker-capable Linux lanes:

```yaml
runs-on: [self-hosted, linux, docker-capable, private]
```

GitHub-hosted fallback for trust-boundary or hosted-image reasons:

```yaml
runs-on: ubuntu-latest
```

## Migration Checklist For A Private Repo

1. Split the workflow by workload type instead of trying to move everything at once.
2. Move shell-safe Node, Python `3.12`, Terraform, and docs lanes to Synology first.
3. Move macOS-native lanes to Lume when you need real Apple hosts.
4. Move Docker/container/service lanes to the Linux Docker plane once the dedicated host is provisioned.
5. Run `pnpm doctor -- full --env .env` before provisioning or changing pool assignments.
6. Add or update custom labels in any downstream actionlint config so workflow linting understands the self-hosted labels you use.
7. Keep untrusted public fork PR lanes on GitHub-hosted runners even if the rest of the private repo has moved.

## Decision Shortcut

If a job can run in bash with the baked-in shell-safe toolchain, prefer Synology.

If it needs Apple tooling, prefer Lume.

If it needs Docker semantics, prefer the Linux Docker plane.

If it needs a much broader hosted image or an untrusted public fork boundary, keep it on GitHub-hosted runners.
