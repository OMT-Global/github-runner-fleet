# Roadmap

This is the high-level operator view. GitHub issues are the execution source of truth; completed work moves to release notes and repository history instead of remaining in future-looking sections.

## In Progress

### Production Fleet Reliability

- Runner and image freshness, transactional publication, and cross-plane artifact parity: [#149](https://github.com/OMT-Global/github-runner-fleet/issues/149), [#150](https://github.com/OMT-Global/github-runner-fleet/issues/150), and [#151](https://github.com/OMT-Global/github-runner-fleet/issues/151).
- Drain/re-registration correctness, Lume teardown, bounded remote I/O, and durable audit records: [#152](https://github.com/OMT-Global/github-runner-fleet/issues/152) through [#156](https://github.com/OMT-Global/github-runner-fleet/issues/156).
- Docker API compatibility for the public Linux plane: [#164](https://github.com/OMT-Global/github-runner-fleet/issues/164).

### Access Gate

CloudCurator access to the isolated public macOS pool is tracked in [#166](https://github.com/OMT-Global/github-runner-fleet/issues/166). This requires organization runner-group administration and remains an explicit human-controlled gate.

## Next

### Reusable Workflow Contracts

Publish pinned `rg-ci`, `rg-security`, and `rg-release` contracts with consumer examples and release verification under [#117](https://github.com/OMT-Global/github-runner-fleet/issues/117).

### Event-Driven Autoscaling

Finish authenticated `workflow_job` admission, durable desired-capacity reconciliation, and operator observability under [#119](https://github.com/OMT-Global/github-runner-fleet/issues/119).

## Operating Principles

- Keep Synology runners shell-only and explicit about unsupported workload classes.
- Keep untrusted public work off private persistent pools.
- Treat GitHub policy, image publication, registration, and teardown as transactional operator surfaces.
- Keep Lume macOS capacity ephemeral and host-controlled.
- Reconcile this document from the live issue graph whenever priorities or issue state change.
