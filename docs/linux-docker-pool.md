# Linux Docker Pool

This plane exists for private-repo workflows that need real Linux Docker semantics without weakening the Synology shell-only boundary.

## What It Runs

- `container:` jobs
- service containers
- Docker daemon workflows
- Buildx and image assembly lanes
- Kind and heavier Linux integration tests

## What It Does Not Replace

- Synology for shell-safe jobs
- Lume for macOS-native jobs
- GitHub-hosted runners for public fork PR trust boundaries or broad hosted image convenience

## Default Contract

- Runner group: `linux-docker-private`
- Labels: `self-hosted`, `linux`, `docker-capable`, `private`
- Execution model: one job per runner, ephemeral registration, short-lived GitHub tokens, dedicated Docker host

## Operator Commands

```bash
pnpm doctor -- linux-docker --env .env --linux-docker-config config/linux-docker-runners.yaml
pnpm validate-linux-docker-config -- --config config/linux-docker-runners.yaml --env .env
pnpm validate-linux-docker-github -- --config config/linux-docker-runners.yaml --env .env
pnpm linux-docker-status -- --config config/linux-docker-runners.yaml --env .env --result .tmp/linux-docker-status.json
pnpm render-linux-docker-compose -- --config config/linux-docker-runners.yaml --env .env --output docker-compose.linux-docker.yml
pnpm render-linux-docker-project-manifest -- --config config/linux-docker-runners.yaml --env .env
pnpm install-linux-docker-project -- --config config/linux-docker-runners.yaml --env .env --status-output .tmp/linux-docker-status.json
pnpm teardown-linux-docker-project -- --config config/linux-docker-runners.yaml --env .env --status-output .tmp/linux-docker-status.json
```

`install-linux-docker-project` and `teardown-linux-docker-project` use `ssh` and `scp` to stage the compose project on `LINUX_DOCKER_HOST`, then run a generated deployment script on that host. Use SSH keys or agent forwarding; do not bake credentials into the runner image.

Use `pnpm doctor -- linux-docker ...` for preflight validation and `pnpm linux-docker-status ...` to inspect the latest saved install or teardown result after a remote run.

## Example Workflow Placements

Container jobs:

```yaml
runs-on: [self-hosted, linux, docker-capable, private]
container:
  image: node:24-bookworm
steps:
  - uses: actions/checkout@v6
  - run: node --version
```

Service containers:

```yaml
runs-on: [self-hosted, linux, docker-capable, private]
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_PASSWORD: postgres
steps:
  - uses: actions/checkout@v6
  - run: pnpm test:integration
```

Docker daemon / Buildx:

```yaml
runs-on: [self-hosted, linux, docker-capable, private]
steps:
  - uses: actions/checkout@v6
  - run: docker buildx version
  - run: docker build -t app:test .
```
