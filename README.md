# Synology GitHub Runner

Shell-only, ephemeral GitHub self-hosted runner pools for Synology NAS deployments.

## What This Repo Builds

- A custom multi-arch runner image based on the official `actions/runner` tarballs
- Built-in shell-job baseline tooling:
  - Node.js `18.20.8`
  - Python `3.12`
  - Terraform `1.6.6`
  - `git`, `bash`, `tar`, `zstd`, and `procps`
- No Docker socket mounts
- No privileged containers
- No host-network mode
- Two organization runner pools by default:
  - `synology-private`
  - `synology-public`

This v1 runner class supports shell jobs, JavaScript actions, composite actions, standard `actions/setup-node` flows, and Terraform CLI workflows. It does not support Docker-based actions, `container:` jobs, or service containers.

## Repo Layout

- [config/pools.yaml](/Users/johnteneyckjr./src/synology-github-runner/config/pools.yaml): non-secret pool config
- [docker/Dockerfile](/Users/johnteneyckjr./src/synology-github-runner/docker/Dockerfile): runner image build
- [docker/runner-entrypoint.sh](/Users/johnteneyckjr./src/synology-github-runner/docker/runner-entrypoint.sh): ephemeral registration and cleanup flow
- [src/cli.ts](/Users/johnteneyckjr./src/synology-github-runner/src/cli.ts): config validation, compose rendering, and runner release helpers

## Quick Start

1. Copy `.env.example` to `.env` and set `GITHUB_PAT`.
2. Edit `config/pools.yaml` for your organization, runner groups, and repository access policy.
3. Install dependencies:

```bash
pnpm install
```

4. Validate the config:

```bash
pnpm validate-config -- --config config/pools.yaml --env .env
```

5. Validate that the configured GitHub runner groups already exist in the target organization:

```bash
pnpm validate-github -- --config config/pools.yaml --env .env
```

This catches mismatched or missing `runnerGroup` values before Synology starts containers that would otherwise enter a restart loop.

6. Render the compose file:

```bash
pnpm render-compose -- --config config/pools.yaml --env .env --output docker-compose.generated.yml
```

The sample config uses `architecture: auto`, which lets Docker pull the native image variant from a multi-arch tag. If you pin `architecture` to `amd64` or `arm64`, Compose will force that platform explicitly.

If you set `resources.cpus` or `resources.pidsLimit`, `validate-config` and `render-compose` will warn because many Synology kernels reject Docker NanoCPUs, CPU CFS quotas, and PID cgroup limits. The sample config omits both limits for that reason.

7. Build the runner image:

```bash
./scripts/build-image.sh ghcr.io/your-org/synology-github-runner:0.1.5 --push
```

When `--push` is used without an explicit `--platform`, the helper now defaults to `linux/amd64,linux/arm64` so the same tag works across Intel and ARM Synology models. A single-arch tag combined with the wrong `platform` or `architecture` setting will fail at startup with `Exec format error`.

Before you deploy a pushed tag, validate that the configured image tag is actually present in GHCR:

```bash
pnpm validate-image -- --config config/pools.yaml --env .env
```

8. Deploy the generated compose file to Synology Container Manager and start the stack.

## Publishing A Release Image

Use [release-image.yml](/Users/johnteneyckjr./src/synology-github-runner/.github/workflows/release-image.yml) for published tags instead of relying on an ad hoc local push. The workflow runs on GitHub-hosted runners, not the Synology shell-only pool, because it needs multi-arch Buildx, QEMU, and registry publish support.

The release workflow:

- enforces that `package.json` version matches `config/pools.yaml` image tag
- validates `config/pools.yaml`
- runs the local `pnpm smoke-test` contract on `linux/amd64`
- publishes the configured tag from `config/pools.yaml`
- verifies the pushed tag with `docker buildx imagetools inspect`
- confirms both `linux/amd64` and `linux/arm64` are present
- retries `pnpm validate-image` until the GitHub Packages API sees the new tag
- runs post-publish toolchain checks for both `linux/amd64` and `linux/arm64`
- can create the matching GitHub release tag `v<version>` when dispatched from `main` with `publish_project_release=true`

Only point [config/pools.yaml](/Users/johnteneyckjr./src/synology-github-runner/config/pools.yaml) at a tag that this workflow has already published and verified.

If you want the repository release and GHCR image tag to stay aligned, merge the version bump to `main` first and then run the release workflow from `main` with `publish_project_release=true`. That will create the repo tag and GitHub Release after the image publish/verify steps succeed.

## Runtime Contract

- Each service handles one job, de-registers, and restarts cleanly.
- GitHub registration and removal both use short-lived tokens minted from the configured PAT.
- Public and private repos use separate runner groups and labels.
- `repositoryAccess: all` is the org-wide mode for a runner group.
- `repositoryAccess: selected` requires `allowedRepositories` and documents the intended selected-repo set for that pool.
- Public repos must not receive long-lived secrets from this runner class.
- GitHub enforces repo access on the runner group side; this repo carries that policy into validation, metadata, and rendered compose output.
- The image keeps the official runner bundle under `/actions-runner` as a read-only source and copies it into a writable per-runner home under `RUNNER_STATE_DIR` before startup.
- The runner work tree is container-local at `RUNNER_WORK_DIR=/tmp/github-runner-work` so Actions temp extraction does not inherit Synology bind-mount ownership restrictions.
- The image exposes a dedicated container-local Actions temp directory at `RUNNER_TEMP=/tmp/github-runner-temp` and a hosted tool cache at `RUNNER_TOOL_CACHE=/opt/hostedtoolcache` so `actions/setup-node` and cache-aware shell workflows do not depend on Synology bind-mount ownership semantics.
- In root-fallback mode, the entrypoint will recreate those container-local runtime directories if Synology rejects an in-place permission refresh, instead of crashing the container during startup.
- On Synology bind mounts that reject `chown`, the entrypoint falls back to root runner execution with `RUNNER_ALLOW_RUNASROOT=1` so the service can still start cleanly from that writable runner home.
- The writable-home copy intentionally extracts without restoring archive ownership, so Synology mounts do not emit a `tar: Cannot change ownership ... Operation not permitted` line for every runner file.

Recommended workflow labels:

- Private repos: `runs-on: [self-hosted, synology, shell-only, private]`
- Public repos: `runs-on: [self-hosted, synology, shell-only, public]`

## Security Notes

- No extra NAS shares should be mounted into the runner services.
- Do not publish ports from the runner containers.
- Keep resource limits enabled in `config/pools.yaml`.
- Prefer memory-only limits on Synology. Only set `resources.cpus` or `resources.pidsLimit` if you have verified your NAS kernel supports Docker CPU CFS quotas and PID cgroup limits.
- Do not add Compose `init: true` for these services. The image already uses `tini`, and double-init setups on Synology produce noisy subreaper warnings.
- For public pools, use DSM firewall rules to reduce unnecessary LAN reachability.
- If you need `container:` jobs or service containers later, create a second runner class instead of weakening this one.

## Useful Commands

```bash
pnpm validate-config -- --config config/pools.yaml --env .env
pnpm validate-github -- --config config/pools.yaml --env .env
pnpm validate-image -- --config config/pools.yaml --env .env
pnpm render-compose -- --config config/pools.yaml --env .env --output docker-compose.generated.yml
pnpm check-runner-version -- --env .env
pnpm runner-release-manifest -- --env .env
pnpm smoke-test
```

## Local Smoke Test

Run this from a machine with a live Docker daemon and Buildx support:

```bash
pnpm smoke-test
```

The smoke test:

- builds the local runner image
- starts a mock GitHub token API on an isolated Docker network
- mounts stubbed `config.sh` and `run.sh` files into `/actions-runner` as the read-only runner source
- verifies registration token fetch, runner config flags, run invocation, remove token fetch, and cleanup for both the normal runner-user mode and the Synology-style root-fallback mode

Useful overrides:

```bash
DOCKER_CONTEXT=colima pnpm smoke-test
SMOKE_PLATFORM=linux/amd64 pnpm smoke-test
SMOKE_KEEP_ARTIFACTS=1 pnpm smoke-test
```

## Manual Acceptance Checklist

- Build and launch both pools on the Synology NAS
- Verify both runner groups appear online in GitHub
- Verify the private runner group is set to the repo access policy you intend, such as "All repositories" for an org-wide private pool
- Verify the generated compose file does not pin `platform:` unless you intentionally forced `architecture`
- Run a private-repo shell workflow with secrets
- Run a public-repo shell workflow without secrets
- Run a self-hosted workflow that uses `actions/setup-node` with `cache: pnpm`
- Verify `python3 --version` reports `3.12.x` and `terraform version` reports `1.6.6`
- Confirm each job de-registers the runner and the service restarts cleanly
- Confirm there is no Docker socket mount in the rendered compose file
