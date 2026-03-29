    # Bootstrap Onboarding

    ## Repo Governance

    - Confirm the repository exists at `OMT-Global/synology-github-runner`.
    - Confirm branch protection or rulesets on `main` require one approval and code owner review.
    - Confirm branch protection points at the `CI Gate` status.
    - Confirm `delete branch on merge` and `allow auto-merge` are enabled.

    ## Environments

    - `dev`: open by default for rapid iteration.
    - `stage`: one reviewer required and self-review blocked.
    - `prod`: one reviewer required, self-review blocked, deployments limited to `main`.

    ## Runner Policy

    - Shell-safe jobs may use `[self-hosted, synology, shell-only, public]`.
    - Docker, service-container, browser, and `container:` workloads stay on GitHub-hosted runners.
    - Keep PR checks cheap. Add heavy validation to `scripts/ci/run-extended-validation.sh` instead of the PR lane.

    ## Home Profiles

    - Run `project-bootstrap apply home --manifest ./project.bootstrap.yaml` after reviewing the bundled profile content.
    - The bootstrap manages portable Codex and Claude assets only. Auth, sessions, caches, and machine-local state stay unmanaged.

    ## Claude Setup

    - First-party Claude web sessions should use `bash scripts/claude-cloud/setup.sh` in `claude.ai/code`.
- Interactive Claude work is prepared through `.devcontainer/devcontainer.json`.
- GitHub-hosted Claude automation lives in `.github/workflows/claude.yml` and is intentionally separate from the required PR checks.
- Finish GitHub-side auth by running `/install-github-app` in Claude Code or adding `ANTHROPIC_API_KEY` as a repo secret.
