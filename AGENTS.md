# AGENTS

- Always work on a feature branch. Hooks block commits to `main` and `master`; enable them with `git config core.hooksPath .githooks`.
- Stack baseline: Generic polyglot.
- CI baseline: fast PR checks stay cheap and shell-safe; extended validation runs on `main`, nightly, or manual dispatch.
- Self-hosted runner policy: shell-safe jobs may use `[self-hosted, synology, shell-only, public]`; anything needing Docker, service containers, browser infra, or `container:` must stay on GitHub-hosted runners.
- Add or update tests for every interactive, branching, or operator-facing behavior change.
- Never commit real secrets, runtime auth, or machine-local env files. Use templates and GitHub environments instead.

## Local Conventions

- Keep scope tight and favor predictable templates over clever scaffolding.
- Treat `project.bootstrap.yaml` as the source of truth for repo governance, environments, CI policy, and home profile sync.
- Review `docs/bootstrap/onboarding.md` before first merge to confirm reviewers, runner labels, and environment gates match the project.
