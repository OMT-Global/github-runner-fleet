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
- The sample config starts with four private runner slots and two public runner slots.

This v1 runner class supports shell jobs, JavaScript actions, composite actions, the bundled shell-safe Node setup action, built-in Python `3.12` workflows, local `actions/setup-python@v6` resolution for Python `3.12`, and Terraform CLI workflows. It does not support Docker-based actions, `container:` jobs, or service containers.

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

5. Run the unified fleet doctor before deployment changes:

```bash
pnpm doctor -- all --env .env --config config/pools.yaml --lume-config config/lume-runners.yaml
pnpm doctor -- synology --env .env --config config/pools.yaml --format json
pnpm doctor -- lume --env .env --lume-config config/lume-runners.yaml
```

`doctor` gives one operator-facing preflight for the whole fleet or for a targeted surface. It reuses the existing Synology and Lume validators, checks that the configured runner groups still exist, confirms the Synology image tag is present in GHCR, verifies shared GitHub API reachability, and emits either human-readable text or stable JSON for automation.

6. Validate that the configured GitHub runner groups already exist in the target organization:

```bash
pnpm validate-github -- --config config/pools.yaml --env .env
```

This catches mismatched or missing `runnerGroup` values before Synology starts containers that would otherwise enter a restart loop.

7. Render the compose file:

```bash
pnpm render-compose -- --config config/pools.yaml --env .env --output docker-compose.generated.yml
```

The sample config uses `architecture: auto`, which lets Docker pull the native image variant from a multi-arch tag. If you pin `architecture` to `amd64` or `arm64`, Compose will force that platform explicitly.

If you set `resources.cpus` or `resources.pidsLimit`, `validate-config` and `render-compose` will warn because many Synology kernels reject Docker NanoCPUs, CPU CFS quotas, and PID cgroup limits. The sample config omits both limits for that reason.

8. Build the runner image:

```bash
./scripts/build-image.sh ghcr.io/your-org/synology-github-runner:0.1.9 --push
```

When `--push` is used without an explicit `--platform`, the helper now defaults to `linux/amd64,linux/arm64` so the same tag works across Intel and ARM Synology models. A single-arch tag combined with the wrong `platform` or `architecture` setting will fail at startup with `Exec format error`.

Before you deploy a pushed tag, validate that the configured image tag is actually present in GHCR:

```bash
pnpm validate-image -- --config config/pools.yaml --env .env
```

8. Deploy the generated compose file to Synology Container Manager and start the stack.

For a fully programmatic install from your workstation, this repo can also reuse your local [synology-api](https://github.com/N4S4/synology-api) checkout to stage the compose project and trigger `docker compose up -d` on the NAS through DSM Task Scheduler:

```bash
pnpm render-synology-project-manifest -- --config config/pools.yaml --env .env
pnpm install-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json
pnpm teardown-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json
pnpm synology-status -- --config config/pools.yaml --env .env --result .tmp/synology-status.json
```

That installer path:

- uploads `compose.yaml` plus a project-local `.env` into `SYNOLOGY_PROJECT_DIR`
- creates a one-shot root Task Scheduler task through `synology-api`
- runs `docker compose -p $COMPOSE_PROJECT_NAME up -d --force-recreate --remove-orphans`
- deletes the temporary scheduled task after completion

`install-synology-project` is the recreate/resize path. If you change [config/pools.yaml](/Users/johnteneyckjr./src/synology-github-runner/config/pools.yaml) from four private runners to two, or from two public runners to six, rerun `pnpm install-synology-project ...` and the generated compose project will reconcile to the new slot counts. `--force-recreate` refreshes existing services, and `--remove-orphans` removes slots that no longer exist in the rendered compose file.

Use `pnpm teardown-synology-project ...` when you want an explicit `docker compose down` on the NAS before reinstalling or when you want the runner project fully stopped.

Use `pnpm synology-status ...` after an install or teardown attempt to inspect the saved DSM task result, the last known compose project state returned by `synology-api`, the expected remote log path, and the next troubleshooting steps. `install-synology-project` and `teardown-synology-project` now support `--status-output` so operators can persist the latest result for that command surface.

### Synology operator runbook

Recommended flow:

1. `pnpm validate-config -- --config config/pools.yaml --env .env`
2. `pnpm validate-github -- --config config/pools.yaml --env .env`
3. `pnpm validate-image -- --config config/pools.yaml --env .env`
4. `pnpm install-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json`
5. `pnpm synology-status -- --config config/pools.yaml --env .env --result .tmp/synology-status.json`
6. If recovery is needed, run `pnpm teardown-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json` and inspect status again before reinstalling.

### Synology troubleshooting guide

| Symptom | Next step |
| --- | --- |
| GitHub registration/auth failures | Run `pnpm validate-github -- --config config/pools.yaml --env .env` and confirm `GITHUB_PAT` plus runner groups are still valid. |
| Image tag drift or pull failures | Run `pnpm validate-image -- --config config/pools.yaml --env .env` before reinstalling. |
| Synology path permission failures | Inspect the remote `install-project.log` path reported by `pnpm synology-status` and verify `SYNOLOGY_PROJECT_DIR` plus runner state directories are writable. |
| DSM task failure or timeout | Review the saved task result via `pnpm synology-status -- --result .tmp/synology-status.json`, then inspect the remote log path it prints. |
| Need a clean rollback/recovery cycle | Run `pnpm teardown-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json`, confirm the saved result, then reinstall. |

It intentionally avoids undocumented `SYNO.Docker.Project create/import` calls. If the Synology Docker daemon can see the compose project normally, Container Manager should still surface it as a compose project after the install task runs.

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
- The image exposes a dedicated container-local Actions temp directory at `RUNNER_TEMP=/tmp/github-runner-temp` and a hosted tool cache at `RUNNER_TOOL_CACHE=/opt/hostedtoolcache` so shell-safe tool bootstrap actions do not depend on Synology bind-mount ownership semantics.
- In root-fallback mode, the entrypoint will recreate those container-local runtime directories if Synology rejects an in-place permission refresh, instead of crashing the container during startup.
- On Synology bind mounts that reject `chown`, the entrypoint falls back to root runner execution with `RUNNER_ALLOW_RUNASROOT=1` so the service can still start cleanly from that writable runner home.
- The writable-home copy intentionally extracts without restoring archive ownership, so Synology mounts do not emit a `tar: Cannot change ownership ... Operation not permitted` line for every runner file.

Recommended workflow labels:

- Private repos: `runs-on: [self-hosted, synology, shell-only, private]`
- Public repos: `runs-on: [self-hosted, synology, shell-only, public]`

## Reusable Setup Actions

For Node projects on shell-only runners, use the bundled action instead of `actions/setup-node`:

```yaml
- uses: OMT-Global/synology-github-runner/actions/setup-shell-safe-node@main
  with:
    node-version: 24.14.1
```

Use that action on self-hosted Synology runners where `actions/setup-node` would otherwise fail while extracting tool archives. Keep `actions/setup-node` on GitHub-hosted jobs.

The shell-only runner image directly supports these job profiles without Docker or service containers:

- Node `18` plus `npm` with `actions/cache`
- Node `24` when bootstrapped through `OMT-Global/synology-github-runner/actions/setup-shell-safe-node`
- Python `3.12` plus `pip` with `actions/cache`
- `actions/setup-python@v6` when `python-version: '3.12'`
- Terraform `1.6.6` plus plugin-cache directories under `RUNNER_TEMP`
- Bash/docs validation jobs that only need the standard CLI toolchain

For Python projects, the runner image already carries Python `3.12` and exposes that exact interpreter through `RUNNER_TOOL_CACHE`, so `actions/setup-python@v6` with `python-version: '3.12'` resolves locally on these runners instead of attempting a distro-specific download. Repos that only need `3.12` can stay on the shell-only pool. Repos with Python version matrices should keep the non-`3.12` lanes on GitHub-hosted runners and only route the built-in `3.12` lane to self-hosted runners.

For OpenClaw Ouro style workflows, the compatible jobs are the Node/npm validators, docs checks, Python `3.12` linting, Terraform validation, and smoke scripts that stay within bash plus the baked-in toolchain. Keep workflow-parser jobs that rely on extra distro packages, plus any `container:`, `services:`, browser, or Docker-daemon jobs, on GitHub-hosted runners.

For a copy-paste-ready compatibility matrix and downstream workflow recipes, see [docs/workflow-cookbook.md](docs/workflow-cookbook.md).

## Lume macOS Pool

This repo now also carries a separate host-side control plane for pooled macOS runner VMs under [config/lume-runners.yaml](/Users/johnteneyckjr./src/synology-github-runner/config/lume-runners.yaml). This is not a macOS container path. `lume` runs full macOS VMs, and the host scripts recycle per-slot VM clones from a sealed base VM so the job host itself is ephemeral.

The Lume flow is:

- create and seal a base VM such as `macos-runner-base`
- run [scripts/lume/reconcile-pool.sh](/Users/johnteneyckjr./src/synology-github-runner/scripts/lume/reconcile-pool.sh) on the host MacBook
- let each slot clone boot, receive bootstrap assets over `lume ssh`, register one ephemeral runner in `macos-private`, run one job, and get destroyed

Useful Lume commands:

```bash
pnpm validate-lume-config -- --config config/lume-runners.yaml --env .env
pnpm validate-lume-github -- --config config/lume-runners.yaml --env .env
pnpm render-lume-runner-manifest -- --config config/lume-runners.yaml --env .env --slot 1
bash scripts/lume/create-base-vm.sh --config config/lume-runners.yaml --env .env
bash scripts/lume/reconcile-pool.sh --config config/lume-runners.yaml --env .env
bash scripts/lume/reconcile-pool.sh --config config/lume-runners.yaml --env .env --dry-run
bash scripts/lume/reconcile-pool.sh --config config/lume-runners.yaml --env .env --once
bash scripts/lume/status.sh --config config/lume-runners.yaml --env .env
bash scripts/lume/status.sh --config config/lume-runners.yaml --env .env --format json
```

Keep the Lume runner env file outside git and locked down with `chmod 600`. The host controller reads that file and copies it into each guest VM just before starting the guest bootstrap. Do not bake GitHub credentials into the base VM image.

### Lume host layout and lifecycle playbook

Treat the Lume host data as three separate layers:

- base image state: the sealed base VM named by `vmBaseName`
- host control-plane state: `LUME_RUNNER_BASE_DIR`, slot metadata under `slots/`, and logs under `logs/`
- per-slot ephemeral state: cloned VMs named from `vmSlotPrefix`, transient guest bootstrap assets, and the copied runner env file

A safe operator workflow looks like this:

1. Validate the config and GitHub runner-group mapping.
2. Create the base VM with `scripts/lume/create-base-vm.sh`.
3. Boot the base VM manually, install Xcode and any pinned host-side prerequisites, verify the guest user can run CI workloads, then shut the VM down cleanly.
4. Keep credentials out of the base image. Store them only in the host-side env file referenced by `LUME_RUNNER_ENV_FILE`.
5. Run `scripts/lume/reconcile-pool.sh --dry-run` before starting or resizing the pool so you can see whether each slot will be created or have its worker restarted.
6. Start the pool with `scripts/lume/reconcile-pool.sh`.
7. Use `scripts/lume/status.sh --format json` for machine-readable status checks, and the default text output for quick terminal inspection.

### Recovering and rotating Lume capacity

- If one slot is unhealthy, stop its worker and recycle only that slot:
  - inspect `logs/slot-XX.log` and `logs/slot-XX-vm.log`
  - run `bash scripts/lume/destroy-slot.sh --slot <n> --config config/lume-runners.yaml --env .env`
  - rerun `bash scripts/lume/reconcile-pool.sh --once --config config/lume-runners.yaml --env .env`
- If the base image needs updates, shut down the pool, update and reseal the base VM, then rerun `reconcile-pool.sh` so fresh clones inherit the new image state.
- `reconcile-pool.sh` now fails fast when the configured base VM is missing, which helps catch accidental host cleanup before the controller loops forever.

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
pnpm doctor -- all --env .env --config config/pools.yaml --lume-config config/lume-runners.yaml
pnpm doctor -- synology --env .env --config config/pools.yaml --format json
pnpm doctor -- lume --env .env --lume-config config/lume-runners.yaml
pnpm validate-config -- --config config/pools.yaml --env .env
pnpm validate-github -- --config config/pools.yaml --env .env
pnpm validate-image -- --config config/pools.yaml --env .env
pnpm render-compose -- --config config/pools.yaml --env .env --output docker-compose.generated.yml
pnpm render-synology-project-manifest -- --config config/pools.yaml --env .env
pnpm install-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json
pnpm teardown-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json
pnpm synology-status -- --config config/pools.yaml --env .env --result .tmp/synology-status.json
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
- verifies the built-in Python `3.12` tool-cache entry resolves to the baked-in interpreter
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
- Run a self-hosted workflow that uses `OMT-Global/synology-github-runner/actions/setup-shell-safe-node@<ref>`
- Run a self-hosted workflow that uses `actions/setup-python@v6` with `python-version: '3.12'`
- Verify `python3 --version` reports `3.12.x` and `terraform version` reports `1.6.6`
- Confirm each job de-registers the runner and the service restarts cleanly
- Confirm there is no Docker socket mount in the rendered compose file
