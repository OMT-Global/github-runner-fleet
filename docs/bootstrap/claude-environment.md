# Claude Environment

## Project

- Repository: `OMT-Global/github-runner-fleet`
- Manifest: `project.bootstrap.yaml`

## Enabled Surfaces

- Claude Code on the web with `bash scripts/claude-cloud/setup.sh`
- Interactive devcontainer through `.devcontainer/devcontainer.json`
- GitHub-hosted Claude workflow at `.github/workflows/claude.yml`

## Guardrails

- Keep Claude automation out of the required PR check set unless the manifest explicitly changes branch protection.
- Prefer repo-scoped secrets and avoid mounting additional host credentials into the devcontainer.
