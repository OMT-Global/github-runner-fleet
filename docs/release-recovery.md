# Reviewed release preparation and recovery

Merging a source PR does not publish a release. `Release Image` accepts only an
explicit workflow dispatch from `main`. Release publication, image promotion and
any rollout require their own operator authorization; #229 is not completed by
this source change. The separate access and live-pool issues stay open.

The canonical Actions Runner version is `.runner-version`. A build packages this
file into `dist` so the compiled reader does not depend on a source checkout.
An explicit environment override still wins: this change deliberately does not
clear the stale protected example override or expand permissions on the standalone
reusable-release smoke caller.

## Publication transaction

1. Prove GitHub repository access, then inspect the exact release and GHCR tag.
   Only a specific release 404 and registry `MANIFEST_UNKNOWN` 404 count as absent.
   Authentication failures, throttling, bad responses and network errors stop.
2. A missing final image uses a candidate unique to source SHA, run and attempt.
   An existing final digest enters verification-only recovery mode: it
   does not rebuild, replace, re-sign, or re-attest the digest. A release without its final
   image is inconsistent and cannot authorize a replacement image.
3. Build only the candidate. Sign the index and its platform digests, attach the
   SBOM and emit GitHub Actions SLSA v1 provenance. Signing/SBOM retries are bounded
   to three attempts, with each command bounded to five minutes and retained diagnostics.
4. Verify the index signature, SBOM and SLSA attestation. The successfully verified
   SLSA statement must bind both the image digest and this exact `main` source SHA.
   Legacy or mismatching statements fail closed; do not reinterpret a mismatch as
   permission to overwrite an immutable final tag.
5. Run both Linux architectures by repository@digest before promotion. Require the
   actual runner executable and packaged metadata to match the canonical source
   version, and verify the expected tools. Then promote the verified digest, check
   the promoted digest, validate the image, and optionally create the GitHub Release.

Tests substitute HTTP responses and signed-verification envelopes to exercise
failure decisions; they do not claim to have published, signed or run an actual
release image. Only a separately authorized dispatch can establish that evidence.

The audit rotation regression uses eight real processes importing the audit
module directly. Each announces readiness before a common IPC start signal;
actual disk writes, fsync and lock-mediated rotation remain in use.

## Preserved version decision

The repository cannot prove that 0.2.1 completed the immutable release contract;
it remains a frozen, unreleased candidate and must not be replaced. 0.2.2 was
not published as a verified project release. Version `0.2.3` supersedes these candidates. If an existing digest cannot pass verification,
supersede the candidate with a new version through a separate review; never overwrite it. Package version and configured image
tag must continue to agree.
