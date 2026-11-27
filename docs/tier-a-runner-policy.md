# Tier A Runner Policy

This document is the runner-boundary control plane for Tier A `OMT-Global` repos.

## Runner Groups

### `rg-ci`

- Fast PR gates and deterministic shell-safe validation
- No deploy credentials
- No production network reachability
- Public repositories use GitHub-hosted runners, including trusted branch and release jobs

### `rg-security`

- CodeQL, Semgrep, dependency review, OSV, SonarQube, and other security-only jobs
- Selected repositories only
- Selected workflows only
- No deploy credentials
- No production network reachability

### `rg-release`

- Publish, deploy, and release verification jobs only
- Selected repositories only
- Selected workflows pinned to a branch, tag, or SHA
- OIDC preferred over long-lived secrets

## Workload Rules

- Shell-safe Linux-class runners carry `linux`, `shell-only`, and the `private` label so default shell-safe jobs can land on any eligible Synology or Linux pool.
- Private Linux runners also carry the `synology` compatibility label so existing private Synology-labeled shell jobs can overflow onto Linux capacity.
- Do not treat `synology` as a hard NAS pin after this compatibility rollout.
- Linux Docker runners retain the `docker-capable` plane label for `container:`, service-container, Docker daemon, Buildx, and similar workloads.
- Lume macOS runners are for native macOS/Xcode jobs.
- All public repository jobs run on GitHub-hosted runners. Keep public repository access disabled on self-hosted runner groups.

## Tier A Defaults

- `bootstrap` and other bootstrap-aligned repos should route:
  - `pr-fast-ci` to `rg-ci`
  - `security-pr` to hosted or `rg-security`
  - `extended-validation` to repo-compatible runner classes
  - `release` to hosted or `rg-release`
- `github-runner-fleet` routes ordinary CI jobs to `ubuntu-24.04`; its opt-in shell-safe installed-toolchain contract is restricted to private repositories. Operational drift detection uses hosted Ubuntu.
- Repos with justified exceptions must record them explicitly rather than silently forking policy in workflow YAML.
