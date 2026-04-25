# Tier A Runner Policy

This document is the runner-boundary control plane for Tier A `OMT-Global` repos.

## Runner Groups

### `rg-ci`

- Fast PR gates and deterministic shell-safe validation
- No deploy credentials
- No production network reachability
- Public repos may use this only if the runner class is ephemeral and public-safe

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

- Synology shell-only runners are for shell-safe jobs only.
- Linux Docker runners are for `container:`, service-container, Docker daemon, Buildx, and similar workloads.
- Lume macOS runners are for native macOS/Xcode jobs.
- GitHub-hosted remains the default for public untrusted PRs unless the self-hosted class is explicitly hardened for that trust level.

## Tier A Defaults

- `bootstrap`, `github-runner-fleet`, and other bootstrap-aligned repos should route:
  - `pr-fast-ci` to `rg-ci`
  - `security-pr` to hosted or `rg-security`
  - `extended-validation` to repo-compatible runner classes
  - `release` to hosted or `rg-release`
- Repos with justified exceptions must record them explicitly rather than silently forking policy in workflow YAML.
