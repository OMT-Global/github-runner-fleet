# AGENTS

- Always work on a feature branch. Hooks block commits to `main` and `master`; enable them with `git config core.hooksPath .githooks`.
- Stack baseline: Generic polyglot.
- CI baseline: fast PR checks stay cheap and shell-safe; extended validation runs on `main`, nightly, or manual dispatch.
- Self-hosted runner policy: shell-safe jobs may use `[self-hosted, synology, shell-only, public]`; anything needing Docker, service containers, browser infra, or `container:` must stay on GitHub-hosted runners.
- Add or update tests for every interactive, branching, or operator-facing behavior change.
- Never commit real secrets, runtime auth, or machine-local env files. Use templates and GitHub environments instead.

## Kingdom Governance

- Pheidon is the orchestrator and current gate for repo execution work.
- GitHub issues are the source of record for agent execution work.
- Worker agents should act from assigned or explicitly enabled issues, not free-roaming backlog grabs.
- If an agent authors a PR, that same agent may not approve it. This is a hard rule.
- PR owners must repair their own PRs until merge-ready, including CI failures, rebase/behind-state fixes, mergeability fixes, and requested review changes, unless Pheidon explicitly reassigns ownership.
- Healthy PRs should converge toward auto-merge once required checks are green or intentionally skipped, approvals are satisfied, and no blocking review state remains.
- PRs should link and close their governing issue where possible so issue state remains the durable work contract.

## Local Conventions

- Keep scope tight and favor predictable templates over clever scaffolding.
- Treat `project.bootstrap.yaml` as the source of truth for repo governance, environments, CI policy, and home profile sync.
- Review `docs/bootstrap/onboarding.md` before first merge to confirm reviewers, runner labels, and environment gates match the project.
