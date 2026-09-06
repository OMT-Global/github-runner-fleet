# Image release recovery

`Release Image` is manual and transactional. It no longer publishes on every push to `main`.

For a new version, first update the canonical version and image tag together, merge that change, and dispatch the workflow from `refs/heads/main`. The workflow publishes a unique `candidate-<version>-<commit>-<run-id>-<attempt>` reference. A retry never reuses an earlier candidate tag. It signs and verifies the immutable digest and checks that exact image's runtime on both `linux/amd64` and `linux/arm64` before promoting the digest to the final version tag and creating the matching GitHub Release.

When the final image already exists, the workflow enters verification-only recovery mode: it does not rebuild, replace, re-sign, or re-attest the digest. It verifies the existing signature, SBOM attestation, SLSA provenance, and platform runtimes. A completed Git tag and GitHub Release are left unchanged.

If a final image exists without its GitHub Release, automated recovery first verifies GitHub's source provenance for that exact digest. The provenance must match this repository, `release-image.yml`, `refs/heads/main`, and the current dispatch commit SHA. Any existing Git tag must also be a lightweight tag at that exact SHA. Only then may the workflow finish creating the missing release metadata. This permits a same-source retry after an image-only dispatch (`publish_project_release=false`) or a failed release creation without assigning an unrelated commit to the image. If source verification fails or `main` has advanced, supersede the candidate with a new version; never replace the existing tag.

## `0.2.1` and `0.2.2` recovery decision

The repository cannot prove `0.2.1` completed the immutable release contract, so it is frozen as an unreleased candidate and must not be replaced. Version `0.2.2` was never published as a verified project release, so it must not be treated as a completed release either. Version `0.2.3` supersedes these candidates and is the next permitted release target.

If a GitHub Release or Git tag exists but its image tag is missing, the workflow fails before any registry mutation. Authentication failures, registry outages, and unexpected lookup errors also stop publication; only confirmed manifest absence and GitHub HTTP 404 responses permit a new release. The workflow checks absence again immediately before promotion, and creates the source Git tag with a create-only API call so it cannot silently reuse an unrelated tag.

Signing and SBOM attestation retry transient transport failures up to three times, with a two-minute limit per attempt. This covers the July 28, 2026 candidate's failed Rekor request without disabling transparency-log verification. Permanent signing errors stop immediately. Verification commands remain bounded to five minutes. Lookup, signing, attestation, verification, and runtime logs are retained as a diagnostic artifact on failure.
