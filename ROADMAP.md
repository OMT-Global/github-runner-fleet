# Roadmap

This file is the high-level operator view of where the repo is headed next. The linked GitHub issues are the actionable units; this page stays short on purpose.

## Guiding Direction

- Keep Synology runners shell-only and explicit about unsupported workload classes.
- Treat GitHub policy, image publishing, and runner registration as first-class operator surfaces rather than tribal knowledge.
- Keep the Lume macOS path ephemeral and host-controlled instead of drifting into pet-VM management.

## Next Up

### Unified Fleet Doctor

Status: next
Tracking: [#26](https://github.com/OMT-Global/github-runner-fleet/issues/26)

Build a single preflight and health entrypoint that reuses the repo's existing validators and produces both human-readable guidance and machine-readable output.

### Synology Deployment Status And Troubleshooting

Status: next
Tracking: [#29](https://github.com/OMT-Global/github-runner-fleet/issues/29)

Add a clearer post-install status surface for the DSM task and compose project, then pair it with a tighter troubleshooting guide grounded in the current `synology-api` install path.

### Shell-Safe Workflow Cookbook

Status: next
Tracking: [#28](https://github.com/OMT-Global/github-runner-fleet/issues/28)

Publish downstream-consumer guidance that shows which workflow classes belong on Synology, which belong on Lume, and which should stay on GitHub-hosted runners.

## After That

### Lume Base-VM Lifecycle Hardening

Status: later
Tracking: [#27](https://github.com/OMT-Global/github-runner-fleet/issues/27)

Document and harden the base image, slot repair, and reconcile lifecycle so the macOS pool stays repeatable under long-term host maintenance.
