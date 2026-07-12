# Image release recovery

`Release Image` is manual and transactional. It no longer publishes on every push to `main`.

For a new version, first update the canonical version and image tag together, merge that change, and dispatch the workflow from `main`. The workflow publishes a unique `candidate-<version>-<commit>` reference, signs and verifies its immutable digest, and only then promotes that digest to the final version tag and creates the matching GitHub Release.

For a partially published version such as `0.2.1`, dispatch the workflow without changing the version. If the final image tag already exists, the workflow enters verification-only recovery mode: it does not rebuild, replace, re-sign, or re-attest the digest. If the existing signature, SBOM attestation, and SLSA provenance verify, the workflow may safely create the missing GitHub Release. If verification fails, supersede the candidate with a new version; never replace the existing tag.

## `0.2.1` recovery decision

The repository cannot prove `0.2.1` completed the immutable release contract, so it is frozen as an unreleased candidate and must not be replaced. Version `0.2.2` supersedes it and is the next permitted release target.

If a GitHub Release exists but its image tag is missing, the workflow fails before any registry mutation. Verification commands are bounded to five minutes and their logs are retained as a diagnostic artifact on failure.
