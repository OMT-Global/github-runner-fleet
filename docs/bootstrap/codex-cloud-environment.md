# Codex Cloud Environment

Configure the Codex Web environment in Codex settings for:

- Repo: `OMT-Global/synology-github-runner`
- Base image: `universal`
- Setup mode: manual setup script
- Setup script: `bash scripts/codex-cloud/setup.sh`
- Maintenance script: `bash scripts/codex-cloud/maintenance.sh`
- Agent internet access: off by default; enable limited or unrestricted access only when a task needs it
- Secrets: none required for review tasks by default

## Notes

- Codex cloud tasks automatically read `AGENTS.md` in this repo.
- Setup scripts run in a separate shell session from the agent. Persistent env vars belong in Codex environment settings or `~/.bashrc`.
- This repo uses required PR checks `CI Gate`, so cloud review tasks should preserve that contract.
