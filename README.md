# Synology GitHub Runner

Shell-only, ephemeral GitHub self-hosted runner pools for Synology NAS deployments.

## What This Repo Builds

- A custom multi-arch runner image based on the official `actions/runner` tarballs
- No Docker socket mounts
- No privileged containers
- No host-network mode
- Two organization runner pools by default:
  - `synology-private`
  - `synology-public`

This v1 runner class supports shell jobs, JavaScript actions, and composite actions. It does not support Docker-based actions, `container:` jobs, or service containers.

## Repo Layout

- [config/pools.yaml](/Users/johnteneyckjr./src/synology-github-runner/config/pools.yaml): non-secret pool config
- [docker/Dockerfile](/Users/johnteneyckjr./src/synology-github-runner/docker/Dockerfile): runner image build
- [docker/runner-entrypoint.sh](/Users/johnteneyckjr./src/synology-github-runner/docker/runner-entrypoint.sh): ephemeral registration and cleanup flow
- [src/cli.ts](/Users/johnteneyckjr./src/synology-github-runner/src/cli.ts): config validation, compose rendering, and runner release helpers

## Quick Start

1. Copy `.env.example` to `.env` and set `GITHUB_PAT`.
2. Edit `config/pools.yaml` for your organization, runner groups, and repo allow-lists.
3. Install dependencies:

```bash
pnpm install
```

4. Validate the config:

```bash
pnpm validate-config -- --config config/pools.yaml --env .env
```

5. Render the compose file:

```bash
pnpm render-compose -- --config config/pools.yaml --env .env --output docker-compose.generated.yml
```

6. Build the runner image:

```bash
./scripts/build-image.sh ghcr.io/your-org/synology-github-runner:0.1.0 --platform linux/arm64
```

7. Deploy the generated compose file to Synology Container Manager and start the stack.

## Runtime Contract

- Each service handles one job, de-registers, and restarts cleanly.
- GitHub registration and removal both use short-lived tokens minted from the configured PAT.
- Public and private repos use separate runner groups and labels.
- Public repos must not receive long-lived secrets from this runner class.

Recommended workflow labels:

- Private repos: `runs-on: [self-hosted, synology, shell-only, private]`
- Public repos: `runs-on: [self-hosted, synology, shell-only, public]`

## Security Notes

- No extra NAS shares should be mounted into the runner services.
- Do not publish ports from the runner containers.
- Keep resource limits enabled in `config/pools.yaml`.
- For public pools, use DSM firewall rules to reduce unnecessary LAN reachability.
- If you need `container:` jobs or service containers later, create a second runner class instead of weakening this one.

## Useful Commands

```bash
pnpm validate-config -- --config config/pools.yaml --env .env
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
- mounts stubbed `config.sh` and `run.sh` files into `/actions-runner`
- verifies registration token fetch, runner config flags, run invocation, remove token fetch, and cleanup

Useful overrides:

```bash
DOCKER_CONTEXT=colima pnpm smoke-test
SMOKE_PLATFORM=linux/amd64 pnpm smoke-test
SMOKE_KEEP_ARTIFACTS=1 pnpm smoke-test
```

## Manual Acceptance Checklist

- Build and launch both pools on the Synology NAS
- Verify both runner groups appear online in GitHub
- Run a private-repo shell workflow with secrets
- Run a public-repo shell workflow without secrets
- Confirm each job de-registers the runner and the service restarts cleanly
- Confirm there is no Docker socket mount in the rendered compose file
