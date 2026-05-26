# GitHub Runner Fleet Vision

Version: 0.1

GitHub Runner Fleet is the local control plane for dependable self-hosted runner capacity across OMT-Global projects.

It should make runner lifecycle, labels, runtime installation, and health visible enough that CI queue problems can be diagnosed and repaired without guesswork.

## Who It Serves

- The operator maintaining local and NAS-backed runner capacity.
- Repos that rely on macOS, ARM64, Xcode, or private shell runner labels.
- Agents that need to distinguish code failures from infrastructure queues.

## Product Principles

- Runner state should be inspectable from repeatable commands.
- Labels must communicate real capability.
- Launchd persistence and runtime setup should be source-independent where practical.
- CI queue blockers should be reported separately from test failures.
- Public repos should not depend on private-only runner labels.

## Near-Term Direction

- Harden Lume macOS pool lifecycle.
- Improve install/runtime status surfaces.
- Keep runner registration and label proof easy to capture.
- Document migration paths from private self-hosted runners to hosted or public-safe policies.

## Non-Goals

- Do not hide CI capacity failures behind repo-specific workarounds.
- Do not require every repo to know runner internals.
- Do not make public CI depend on private local hardware.
