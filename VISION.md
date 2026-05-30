# GitHub Runner Fleet Vision

Version: 0.2

GitHub Runner Fleet is the self-hosted runner control plane for OMT-Global. It makes runner capacity explicit across Synology shell-only pools, Linux Docker hosts, Windows Docker hosts, and ephemeral Lume macOS VMs so repos can choose the right execution plane instead of discovering queue failures after a PR is opened.

The product exists to separate code health from infrastructure health. A failing test, a queued macOS job, a private-runner label mismatch, and an unsafe workflow placement should all produce different operator actions.

## Who It Serves

- CI operators maintaining Synology, Docker, Windows, and Lume runner planes.
- Repository maintainers choosing runner labels and public/private workflow policy.
- Agents diagnosing whether a PR is blocked by code, configuration drift, unavailable capacity, or an unsafe workload placement.

## Current Product Boundary

- Synology shell-only plane for shell jobs, JS actions, Python, Terraform, docs, and validation work.
- Linux Docker plane for `container:` jobs, service containers, Docker daemon workflows, Buildx, Kind, and heavier Linux integration.
- Windows Docker plane for Windows container and PowerShell automation lanes.
- Lume macOS plane for ephemeral macOS-native build and test lanes without long-lived snowflake VMs.
- CLI and config surfaces for pool definitions, install/status, audits, metrics, drift, drain, prune, and workflow guidance.

## Product Principles

- Runner labels must describe real capability, not aspiration.
- Synology stays shell-safe; Docker socket, service-container, and privileged work belong on Docker-capable hosts or GitHub-hosted runners.
- Ephemeral runners are the default trust model, especially for private workloads and macOS capacity.
- Public repos should not depend on private-only local hardware unless that is documented as a deliberate blocker.
- Fleet diagnostics should be repeatable from config and API state, not tribal knowledge.

## Near-Term Direction

- Build unified preflight and health diagnostics across all runner planes.
- Improve Synology deployment status, troubleshooting output, and shell-safe cookbook coverage.
- Harden Lume base-VM lifecycle, registration, labels, and launchd persistence.
- Keep the Tier A runner policy and rollout ledger aligned with downstream repo CI gates.

## Non-Goals

- Do not turn Synology into a privileged Docker host.
- Do not hide capacity or label failures inside repo-specific CI workarounds.
- Do not bake GitHub credentials or project secrets into base images or VMs.
- Do not require every downstream repo to understand fleet internals before choosing a safe runner.
