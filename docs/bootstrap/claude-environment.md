    # Claude Environment

    Claude Code on the web provides a first-party cloud environment comparable to Codex Web. This bootstrap prepares the hosted path first, then adds optional local and GitHub-native alternatives:

    - First-party hosted sessions at `claude.ai/code`
- Interactive containerized work with `.devcontainer/devcontainer.json`
- GitHub-hosted automation with `.github/workflows/claude.yml`

## Claude Code On The Web

- Hosted entrypoint: `https://claude.ai/code`
- Repo: `OMT-Global/synology-github-runner`
- Setup script: `bash scripts/claude-cloud/setup.sh`
- Network access: start with limited access; only expand it when a task truly needs more than registries and GitHub
- Environment variables: configure them in the Claude environment UI as `.env`-style key-value pairs
- GitHub integration: connect GitHub, install the Claude GitHub App, then pick this repo as an allowed target
- Repo guidance: Claude on the web reads `CLAUDE.md` from the repository

## Teleport And Remote Sessions

- Start a hosted task from the terminal with `claude --remote "your task"`
- Pull a hosted session back into the terminal with `claude --teleport`
- Hosted tasks clone the default branch unless you specify a branch in the prompt
- Teleport requires a clean git state and the same repository/account pairing

## Interactive Devcontainer

- Open the repo in a devcontainer-capable editor and reopen in container.
- The container installs the Claude Code feature plus repo dependencies via `bash scripts/claude/setup-devcontainer.sh`.
- `~/.claude` is mounted into the container so Claude Code auth persists between sessions.
- Only use this with trusted repositories. Mounted Claude credentials are available inside the container.

## GitHub Action

- Workflow file: `.github/workflows/claude.yml`
- Runner: `ubuntu-latest`
- Triggers:
  - manual `workflow_dispatch`
  - PR or issue comments containing `@claude`
  - review comments or review bodies containing `@claude`
- Auth:
  - preferred: run `/install-github-app` in Claude Code as a repo admin
  - fallback: add a repository secret named `ANTHROPIC_API_KEY`

    ## Guardrails

    - Keep the Claude workflow out of the required PR check set. The required checks are `CI Gate`.
- Prefer Claude Code on the web for long-running async review or fix tasks; use the devcontainer when you need a local interactive container.
- Treat the devcontainer as a trusted-repo workspace because the mounted `~/.claude` profile is available inside the container.
- Do not relax the action to allow non-write users on public repos unless you intentionally accept the prompt-injection risk.
- Keep Claude review and automation on GitHub-hosted runners; do not move it onto the self-hosted shell-only fleet.

    ## Project

    - Repository: `OMT-Global/synology-github-runner`
    - Default branch: `main`
