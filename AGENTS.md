# AGENTS

- Always work on a feature branch. Hooks block commits to `main` and `master`; enable them with `git config core.hooksPath .githooks`.
- Stack baseline: Generic polyglot.
- CI baseline: fast PR checks stay cheap and shell-safe; extended validation runs on `main`, nightly, or manual dispatch.
- Self-hosted runner policy: shell-safe jobs must use `[self-hosted, linux, shell-only, public]`; native repos must use self-hosted runners for required automation, with Docker, service-container, browser, or `container:` workloads routed to dedicated self-hosted capability pools.
- Add or update tests for every interactive, branching, or operator-facing behavior change.
- PRs must use the generated pull request template. The required PR gate validates summary, issue linkage, validation evidence, and risk notes.
- Never commit real secrets, runtime auth, or machine-local env files. Use templates and GitHub environments instead.

## Kingdom Governance

- Pheidon is the orchestrator and current gate for repo execution work.
- GitHub issues are the source of record for agent execution work.
- Worker agents should act from assigned or explicitly enabled issues, not free-roaming backlog grabs.
- If an agent authors a PR, that same agent may not approve it. This is a hard rule.
- Healthy PRs should converge toward auto-merge once required checks are green or intentionally skipped, approvals are satisfied, and no blocking review state remains.
- When GitHub plan limits make auto-merge unavailable for a private repo, use the fallback merge-readiness policy: required checks pass or are intentionally skipped, approvals and conversation resolution are satisfied, no blocking review state remains, and a maintainer performs the merge manually.
- PRs should link and close their governing issue where possible so issue state remains the durable work contract.

## Local Conventions

- Keep scope tight and favor predictable templates over clever scaffolding.
- Treat `project.bootstrap.yaml` as the source of truth for repo governance, environments, CI policy, and home profile sync.
- Review `docs/bootstrap/onboarding.md` before first merge to confirm reviewers, runner labels, and environment gates match the project.
