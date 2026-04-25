# OMT-Global CI/CD Audit

Date: 2026-04-14
Scope baseline: active `OMT-Global` repos visible through the GitHub connector, with local workflow inspection where available and `/Users/johnteneyckjr./src/github-runner-fleet` treated as the intended runner-platform reference.

## Executive Summary

This org does not have a runner-capacity problem. It has a CI shape and trust-separation consistency problem.

The best repos already follow the right pattern: cheap PR gates, separate extended validation, and explicit runner compatibility rules. The weaker repos are not failing because they lack CI. They are failing because they either:

1. collapse PR, push, and privileged execution into one broad workflow,
2. rely on legacy hosted-only pipelines with no split between fast and deep validation, or
3. use self-hosted labels without an explicit security boundary for release/security-only work.

Highest-risk org-wide findings:

1. There is no org-wide `rg-security` or `rg-release` boundary yet. Even the better repos mostly distinguish only between shell-safe self-hosted lanes and GitHub-hosted lanes; they do not yet implement the stricter trust split described in the target state.
2. Several active repos still use legacy single-workflow CI (`Why-fi`, `fix-your-life-app`, `homenet`) or imported pipelines (`synology-api`), which means no standardized PR gate, no nightly/deep validation split, and uneven security coverage.
3. Bootstrap-aligned repos are directionally correct, but the current template still stops at `fast-checks` plus `validate-secrets`; it does not yet centralize dependency review, CodeQL, Semgrep, or OSV in a reusable security workflow.
4. Release isolation is inconsistent. `github-runner-fleet` keeps release work on GitHub-hosted runners, which is good, but that pattern is not yet generalized across the org and is not enforced with selected-workflow access to a separate privileged runner group.
5. Tier B imported/mirrored repos are still visible in the org and can dilute governance if treated as first-class without first normalizing ownership and workflow policy.

## Method

Tiering and scoring rules used here:

- `Tier A`: active first-party, non-archived repos with enough evidence to treat them as current org delivery surfaces.
- `Tier B`: archived repos, imported/mirrored repos, or repos where first-party ownership/pipeline intent is unclear.

Each Tier A repo is scored on:

- Trust boundary
- Runner discipline
- Pipeline shape
- Security coverage
- Reusability/governance
- Operability

Final rating:

- `Green`: structurally sound, incremental hardening only
- `Yellow`: workable but inconsistent, medium-priority cleanup
- `Red`: trust-boundary or pipeline-shape issues that should be fixed before wider policy rollout

## Tier A Ranked Audit

| Rank | Repo | Class | Current runner model | Current pipeline model | Rating | Why it landed here | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `bootstrap` | Bootstrap-aligned split CI | Shell-safe self-hosted for PR/main; hosted for Claude | `pr-fast-ci` + `extended-validation` + `CI Gate` | Green | Clean reference shape and closest thing to org policy template | Use as the source repo for reusable PR/security/release workflows |
| 2 | `github-runner-fleet` | Bootstrap-aligned split CI with release specialization | Shell-safe self-hosted for shell-safe jobs; hosted for Docker/macOS contract and release image work | Split PR/main plus dedicated release workflow | Green | Best concrete runner compatibility discipline in the org | Extend its policy into explicit `rg-ci` / `rg-security` / `rg-release` governance |
| 3 | `openclaw-ouro` | Mixed/custom but intentional | Dynamic routing between self-hosted private and hosted fallback depending on trust | PR fast gate + automerge + extended validation | Green | Strongest trust-aware custom routing; justified repo-specific shape | Preserve custom routing but move security scans into a central reusable security workflow |
| 4 | `axiom` | Mixed/custom but intentional | Public shell-safe self-hosted for trusted repo work; hosted for matrix and Rust stage1 | Custom CI plus split PR/main templates | Yellow | Thoughtful hybrid design, but not yet standardized on org split-CI for the main workload | Normalize around the shared gate model and add central security scans |
| 5 | `lattice` | Bootstrap-aligned split CI, macOS-heavy | Private shell-safe self-hosted plus dedicated self-hosted macOS/Xcode lanes | Split PR/main plus separate Swift CI | Yellow | Good direction, but CI shape is fragmented between template and repo-specific Swift workflow | Consolidate app-specific tests under the split template and isolate deeper macOS validation |
| 6 | `mypersonalbanker` | Bootstrap-aligned split CI, mixed mobile/backend | Private shell-safe self-hosted plus self-hosted macOS/Xcode | Split PR/main plus broad custom CI | Yellow | Strong self-hosted adoption, but broad CI remains separate from template governance and has no explicit security/release boundary | Collapse backend/mobile coverage into the shared fast/deep model and add reusable security checks |
| 7 | `Screensaver` | Bootstrap-aligned split CI | Public shell-safe self-hosted | Split PR/main only | Yellow | Template adoption is good, but public-repo self-hosted use still needs stricter trust proof and separate security/release policy | Keep PR gates cheap, add hosted security scans, and verify no privileged secrets/network are reachable from public runners |
| 8 | `homenet` | Special-case release/docs repo | Hosted only | Single CI + digest/report/release workflows | Yellow | Safe from self-hosted trust issues, but no PR/main split and release/security concerns are mixed with repo-specific automation | Keep hosted execution, but split fast PR validation from release/reporting and add security scanning |
| 9 | `Why-fi` | Legacy/single-workflow | Hosted macOS only | Single CI workflow | Yellow | Safe runner choice, but thin pipeline shape with no split gates, no nightly/deep lane, and no reusable governance hooks | Move to org split CI and add separate extended validation plus secrets/security checks |
| 10 | `fix-your-life-app` | Legacy/single-workflow | Hosted macOS only | Single iOS test workflow | Yellow | Similar to `Why-fi`: low trust risk, weak pipeline shape | Add fast PR gate, extended validation, and shared security checks before scaling contributor volume |
| 11 | `fireworks-game` | Workflow-light / unconfirmed | No local workflow evidence found | No confirmed CI in inspected checkout | Red | Active first-party app repo with no confirmed CI evidence in this pass | Confirm workflow absence, then add minimum PR gate and platform-specific validation immediately |
| 12 | `home-tv-channel-list` | Workflow-light / connector-only | No `.github/workflows/ci.yml` found via contents API; no local clone inspected | No confirmed CI evidence in this pass | Red | Active public repo with no confirmed CI baseline from the evidence gathered | Verify workflow inventory directly and add hosted PR validation at minimum |
| 13 | `omt-corner-cave` | Workflow-light / connector-only | No `.github/workflows/ci.yml` found via contents API; local checkout not wired to org remote in this pass | No confirmed CI evidence in this pass | Red | Infra repo without confirmed guardrails is a governance gap by default | Confirm actual workflow set and add hosted validation plus deployment/release separation |
| 14 | `mac-cksum` | Workflow-light / connector-only | No `.github/workflows/ci.yml` found via contents API; no local clone inspected | No confirmed CI evidence in this pass | Red | Active first-party utility repo with no confirmed baseline | Add minimum hosted CI and secret/dependency checks |
| 15 | `gh-attest` | Special-case release/security repo | No `.github/workflows/ci.yml` found via contents API | No confirmed CI evidence in this pass | Red | Security-sensitive reusable workflow repo should not be effectively ungoverned | Add hosted validation and release integrity checks before wider reuse |
| 16 | `acme-aws` | Connector-only infra repo | No `.github/workflows/ci.yml` found via contents API | No confirmed CI evidence in this pass | Red | Infra repo with no confirmed CI is a direct governance miss | Confirm whether Terraform/security workflows exist; if absent, add them first |

## Tier A Findings By Severity

### Critical

- No repo in scope currently demonstrates the full target-state split of `rg-ci`, `rg-security`, and `rg-release`. The org is still mostly operating with a two-way distinction: shell-safe self-hosted versus GitHub-hosted.
- Several active repos still have no confirmed baseline CI from the evidence gathered: `fireworks-game`, `home-tv-channel-list`, `omt-corner-cave`, `mac-cksum`, `gh-attest`, and `acme-aws`. Those remain red until confirmed otherwise.
- `Screensaver` is public and routes its split-CI template to `[self-hosted, synology, shell-only, public]`. That can be acceptable only if those runners have no privileged network or secrets exposure; otherwise the public trust boundary is weaker than it should be.

### Important

- `Why-fi` and `fix-your-life-app` are low-risk from a runner perspective because they stay on hosted macOS, but they are behind the org standard in pipeline shape. They need PR gates, deeper scheduled validation, and shared security checks.
- `lattice` and `mypersonalbanker` both show useful self-hosted private-runner adoption, but each still has overlapping custom CI alongside the split template. That increases maintenance and weakens central policy enforcement.
- `axiom` has a thoughtful custom hybrid model, including hosted fallback for fork PRs and hosted matrix coverage, but it still lives outside the common governance lane and does not yet consume a central security workflow.
- `homenet` is operationally safe because it stays hosted, but it mixes CI, release packaging, digest reporting, and autopatch automation without a common fast/deep split or reusable security posture.

### Cleanup

- Template drift exists across otherwise aligned repos: action versions differ (`@v4`, `@v6`), path filters vary, and app-specific CI remains partially duplicated outside the shared gate shape.
- `github-runner-fleet` already models correct compatibility rules for Docker-heavy and macOS contract jobs, but those lessons are not yet promoted into a reusable org-wide workflow contract.
- Imported pipeline history remains present in `synology-api`, which is still on `jmcte/synology-api` remote locally and uses legacy Pages plus pre-commit workflows instead of org policy.

## Evidence Notes For Yellow/Red Repos

- `axiom`: custom `ci.yml` mixes trusted self-hosted public jobs and hosted matrix/stage1 jobs instead of using the shared split template; this is intentional but increases policy drift.
- `lattice`: `ci.yml` runs a broad self-hosted macOS lane while `pr-fast-ci.yml` and `extended-validation.yml` also exist, so the repo has overlapping governance surfaces.
- `mypersonalbanker`: custom `ci.yml` drives backend plus iOS/macOS builds on self-hosted runners while the split template also exists; no dedicated security workflow is present.
- `Screensaver`: split template exists, but all fast and extended jobs still run on public self-hosted labels, so trust depends entirely on runner hardening rather than runner-group separation.
- `homenet`: single hosted `ci.yml` plus digest/report/release workflows means no standard PR fast gate and no explicit deep-validation or security-only lane.
- `Why-fi`: only a single hosted macOS workflow was found.
- `fix-your-life-app`: only a single hosted iOS test workflow was found.
- `fireworks-game`: no local workflow files were present in the inspected checkout.
- `home-tv-channel-list`, `omt-corner-cave`, `mac-cksum`, `gh-attest`, `acme-aws`: `.github/workflows/ci.yml` was not found through the GitHub contents API, and code search indexing was unavailable, so these remain red pending direct workflow inventory confirmation.

## Tier B: Excluded From Primary Ranking

Archived or likely imported/mirrored repos should not drive the main rollout order:

- Archived: `personal-knowledge-graph`, `acme-agents`, `company-os`, `demo-repository`
- Likely imported/mirrored from description or local remote evidence: `acme-core` (explicit clone), `synology-api` (local remote points to `jmcte/synology-api`), `machete` (local remote points to `johnmteneyckjr/mac-setup`), `glacier-utilities` (local remote points to `johnmteneyckjr/glacier-utilities`)

Recommendation: keep these visible for reference, but do not spend runner-policy migration effort on them until ownership and desired end-state are explicit.

## Target-State Platform Standard

### Runner Groups

- `rg-ci`
  - For fast PR gates, lint, unit tests, and shell-safe validation
  - No deploy credentials
  - No prod network reachability
  - Public repos may use this only if the underlying runners are truly public-safe and ephemeral

- `rg-security`
  - For CodeQL, Semgrep, dependency review, OSV, SonarQube, and deep security checks
  - Selected-workflow access only
  - No deploy credentials
  - No prod network reachability

- `rg-release`
  - For deploy/release only
  - Selected repositories only
  - Selected pinned workflows only
  - OIDC only; no long-lived cloud keys in repo secrets

### Workflow Contract

- `pr-fast-ci`
  - Cheap, deterministic, repo-compatible checks
  - Required status check remains `CI Gate`
  - No deploy or release steps

- `security-pr`
  - Reusable workflow
  - Runs dependency review, Semgrep diff scan, OSV PR scan, and repo-appropriate CodeQL where warranted
  - Hosted or isolated `rg-security`, never general-purpose persistent runners

- `extended-validation`
  - Runs on `main`, nightly, and manual dispatch
  - Includes slower integration, smoke, release-readiness, and deep validation

- `release`
  - Separate workflow family
  - Pinned reusable workflow reference
  - `rg-release` only if self-hosted is required; otherwise hosted

## Migration Waves

### Wave 1: Stop the Red Gaps

- Confirm workflow inventory for `fireworks-game`, `home-tv-channel-list`, `omt-corner-cave`, `mac-cksum`, `gh-attest`, and `acme-aws`.
- Add a minimum hosted PR validation baseline where CI is absent.
- For infra/security-sensitive repos, add Terraform or release-specific validation before any self-hosted expansion.

### Wave 2: Normalize the Legacy Yellow Repos

- Move `Why-fi` and `fix-your-life-app` onto the split PR/extended model.
- Keep them hosted for now; do not force self-hosted use where hosted macOS is the safer operating point.
- Add shared secret scanning and reusable security workflows.

### Wave 3: Simplify the Mixed Custom Repos

- For `lattice` and `mypersonalbanker`, reduce overlap between custom broad CI and the split template.
- Keep repo-specific macOS/iOS lanes, but hang them off the common fast/deep contract instead of parallel governance.
- For `axiom`, preserve the justified hosted matrix and stage1 coverage while moving security work into shared reusable workflows.

### Wave 4: Add Real Trust Separation

- Stand up `rg-security` and `rg-release`.
- Restrict high-trust groups by selected workflows pinned to branch/tag/SHA.
- Move security scanning out of the general CI lane and out of repo-by-repo bespoke YAML.

### Wave 5: Harden Release and Public-Repo Policy

- Generalize the `github-runner-fleet` release isolation pattern.
- Re-evaluate `Screensaver` public self-hosted execution and either:
  - prove those runners are public-safe and ephemeral, or
  - move public PR execution to hosted runners and reserve self-hosted for trusted same-repo work only.

## Honest Bottom Line

The org already has a viable pattern in `bootstrap`, `github-runner-fleet`, and `openclaw-ouro`. That is enough to standardize from. The weak point is not technical feasibility; it is uneven adoption and incomplete trust separation.

If you do only three things next, do these:

1. Inventory and fix the red repos with missing or unconfirmed CI.
2. Move `Why-fi`, `fix-your-life-app`, `lattice`, and `mypersonalbanker` onto one shared PR/deep-validation contract.
3. Introduce real `rg-security` and `rg-release` boundaries with reusable workflows, because that is the actual blocker to using the runner fleet more aggressively without increasing risk.
