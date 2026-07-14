# Bootstrap Reconciliation

The initial repository bootstrap is complete. `project.bootstrap.yaml` is the control plane for managed repository files and GitHub governance.

- Run `bootstrap plan --manifest ./project.bootstrap.yaml --target . --json` before applying control-plane changes.
- Treat a non-empty repository plan as drift that must be reviewed on a feature branch.
- Compare GitHub settings in the plan with live branch protection, environments, merge policy, and repository features before `apply github`.
- Keep package-manager, CODEOWNERS, reviewer, CI, and environment declarations synchronized with their live counterparts.
- Keep project-specific agent instructions, workflows, CI scripts, security checks, contributor templates, and operator docs out of `repo.managedPaths`; the generic-empty archetype cannot safely render those local contracts.
- Never apply bootstrap output directly to the default branch; publish intentional changes through a reviewed PR.
