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

Runner registration currently uses `GITHUB_PAT` to mint short-lived runner
registration and removal tokens. Treat that PAT as fleet-wide infrastructure
auth: keep it out of images and base VMs, stage it only through generated
environment files or GitHub environments, rotate it after runner-host incidents,
and prefer narrowly scoped/fine-grained credentials where GitHub supports the
required runner APIs.

Docker-capable runner planes mount the host Docker socket or Windows Docker
named pipe. Any repository allowed onto those runner groups can effectively
control the Docker host, so `repositoryAccess: all` requires an explicit
break-glass environment flag and should not be used for public or untrusted
repositories.
