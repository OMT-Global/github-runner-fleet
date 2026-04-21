# Contributing

## Development Flow

1. Create a feature branch.
2. Keep changes focused and reviewable.
3. Run the local checks before opening a pull request:

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm validate-config -- --config config/pools.yaml --env .env.example
```

Snapshot tests lock generated compose and manifest artifacts. When an intentional
renderer change updates those artifacts, refresh and review the golden files with:

```bash
pnpm test -u
git diff -- test/__snapshots__
```

## Pull Requests

Please include:

- what changed
- why it changed
- how it was tested
- any Synology or GitHub setup impact

## Security

If your change affects runner isolation, token handling, or public-repo safety, call that out explicitly in the pull request description.

## Out of Scope for This Runner Class

This project is intentionally shell-only on Synology. Do not add host Docker socket usage, privileged mode, or generic `container:` job support to this runner class.
