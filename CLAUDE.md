    # CLAUDE.md

    ## Project Map

    - `project.bootstrap.yaml`: source of truth for bootstrap policy
- `.github/workflows/`: generated fast and extended CI lanes
- `scripts/claude-cloud/setup.sh`: first-party Claude Code on the web setup script
- `.github/workflows/claude.yml`: opt-in Claude GitHub Action for manual or `@claude` review flows
- `.devcontainer/devcontainer.json`: interactive Claude Code workspace baseline
- `.github/workflows/`: repo CI and review workflows
- `scripts/ci/`: bootstrap CI entrypoints when this repo uses the generated workflow lane
- `scripts/claude/setup-devcontainer.sh`: installs repo dependencies inside the devcontainer
- `.githooks/pre-commit`: branch and env-file guardrail when local hooks are bootstrap-managed
- `docs/bootstrap/onboarding.md`: operator checklist for repo/governance setup
- `docs/bootstrap/claude-environment.md`: Claude setup guide for hosted, interactive, and GitHub-hosted use

    ## Guardrails

    - Keep `CI Gate` as the single required PR status check.
- Use one approval plus code owners on `main` unless the manifest explicitly changes it.
- `stage` and `prod` environments require reviewers and prevent self-review by default.
- Home-level Codex and Claude profile sync is managed by the bootstrap tool, not by ad-hoc manual edits.
- Claude Code on the web should use the repo-managed setup script and keep network access limited by default.
- The generated Claude GitHub Action is a separate review lane. It must not become a required status check.
- Treat the devcontainer as a trusted-repo workspace. Do not mount extra secrets beyond the persisted `~/.claude` profile unless you explicitly need them.
