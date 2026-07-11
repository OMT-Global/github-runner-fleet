# Bootstrap Onboarding

Use this checklist after the first bootstrap render or whenever `project.bootstrap.yaml` changes in a way that affects GitHub policy, environments, or home-profile sync.

## Project

- Repository: `OMT-Global/github-runner-fleet`
- Manifest: `project.bootstrap.yaml`

## Repo Governance

- Confirm branch protection or rulesets on `main` require one approval, code owner review, and approval from someone other than the most recent pusher.
- Confirm branch protection points at the `CI Gate` status.
- Confirm `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` are present as the required contributor and PR guidance surfaces.
- Confirm the pull request template is present and PR Fast CI validates the required PR description sections before CI Gate can pass.
- Confirm `delete branch on merge` and `allow auto-merge` are enabled when the GitHub plan supports them; otherwise record the plan-limit evidence and use the fallback merge-readiness policy.
- Fallback merge readiness requires passing or intentionally skipped required checks, satisfied approvals, resolved conversations, no blocking review state, and a manual maintainer merge.




## Environments

- `dev`: open by default for rapid iteration.
- `stage`: one reviewer required and self-review blocked.
- `prod`: one reviewer required, self-review blocked, deployments limited to `main`.

## Runner Policy

- Shell-safe jobs must use `[self-hosted, linux, shell-only, public]`.
- Native repos must use self-hosted runners for required automation; Docker, service-container, browser, and `container:` workloads require a dedicated self-hosted runner pool with matching capability labels.
- Keep PR checks cheap. Add heavy validation to `scripts/ci/run-extended-validation.sh` instead of the PR lane.

- Consume shared security, release, and AI attestation workflows from the control-plane repo once those contracts are pinned for production use.

## Contributor And PR Guidance

- `CONTRIBUTING.md` defines the contributor workflow, branch expectations, validation expectations, and secret-handling baseline.
- `.github/PULL_REQUEST_TEMPLATE.md` defines the standard PR shape: summary, governing issue link, validation notes, and bootstrap governance checklist.
- To retrofit an existing bootstrapped repo, add `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` to `repo.managedPaths` when that repo restricts managed paths, then run `bootstrap apply repo --manifest ./project.bootstrap.yaml`.
- Keep these files repo-generic unless project metadata or the manifest requires a stricter local rule.

## Fleet Reconciliation

- Run `bootstrap reconcile --workspace-root ~/src --report bootstrap-reconcile.json` first; this is plan-only and does not write files.
- Add `--org OMT-Global` when OpenClaw should enumerate GitHub repos first; missing local checkouts or repos without `project.bootstrap.yaml` are skipped and reported.
- Use `--repo <name...>` as the initial allowlist when onboarding daily OpenClaw reconciliation.
- Use `--apply-repo --create-pr` for unattended repo drift so generated changes go through draft PRs instead of default-branch pushes.
- Use `--apply-github` only after the report shape is trusted because it mutates repository settings, environments, branch protection, and labels directly through the GitHub API.
- Dirty target worktrees are blocked and reported instead of being overwritten.





## Home Profiles

- Run `bootstrap apply home --manifest ./project.bootstrap.yaml` after reviewing the bundled profile content.
- The bootstrap manages portable Codex assets only. Auth, sessions, caches, and machine-local state stay unmanaged.
