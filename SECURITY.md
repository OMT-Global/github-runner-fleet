# Security Policy

## Supported Versions

Security fixes are applied to the latest code on `main` and the latest published container image tag.

## Reporting a Vulnerability

Do not open public GitHub issues for suspected vulnerabilities.

Report security issues privately to the repository maintainers through GitHub security advisories or direct maintainer contact. Include:

- affected version or image tag
- impact summary
- reproduction steps
- suggested mitigation, if known

We will acknowledge receipt, validate the report, and coordinate a fix and disclosure plan.

## Scope Notes

This repository publishes software intended to manage self-hosted GitHub Actions runners. Public repositories should not route untrusted workflow code to privileged or host-sensitive runner environments.

External fork pull requests must stay on GitHub-hosted runners. Self-hosted
runner groups are for trusted same-repository or explicitly allowed private
repository workflows only.

Runner registration should use GitHub App authentication by default. Configure
`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY` for
an app installation scoped to self-hosted runner administration, and keep the
private key in generated environment files or GitHub environments only.
`GITHUB_PAT` remains supported as a fallback for existing deployments; treat it
as fleet-wide infrastructure auth and rotate it after runner-host incidents.

Published runner images are signed keylessly from GitHub Actions OIDC. Verify a
release image before use with:

```sh
cosign verify \
  --certificate-identity-regexp "https://github.com/OMT-Global/github-runner-fleet/.github/workflows/release-image.yml@refs/heads/main" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/omt-global/github-runner-fleet:<tag>
```

The same identity publishes SPDX SBOM and SLSA provenance attestations; verify
them with `cosign verify-attestation --type spdxjson` and
`cosign verify-attestation --type slsaprovenance`.

Docker-capable runner planes mount the host Docker socket or Windows Docker
named pipe. Any repository allowed onto those runner groups can effectively
control the Docker host, so `repositoryAccess: all` requires an explicit
break-glass environment flag and should not be used for public or untrusted
repositories.
