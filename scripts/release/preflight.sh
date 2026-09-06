#!/usr/bin/env bash
set -euo pipefail

final_ref="${1:?usage: preflight.sh <image:tag> <release-tag>}"
release_tag="${2:?release tag is required}"
: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_SHA:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"
: "${GITHUB_OUTPUT:?}"
log_dir="${RELEASE_LOG_DIR:-/tmp/runner-release}"
mkdir -p "${log_dir}"

if [[ ! "${GITHUB_SHA}" =~ ^[0-9a-f]{40}$ || ! "${GITHUB_RUN_ID}" =~ ^[0-9]+$ || ! "${GITHUB_RUN_ATTEMPT}" =~ ^[0-9]+$ ]]; then
  echo "invalid immutable release run identity" >&2
  exit 1
fi
if [[ "${final_ref}" == *@* || "${final_ref}" != *:* || "${release_tag}" != "v${final_ref##*:}" ]]; then
  echo "release tag must match the versioned image reference" >&2
  exit 1
fi

final_digest=""
if final_digest="$(docker buildx imagetools inspect "${final_ref}" --format '{{.Manifest.Digest}}' 2>"${log_dir}/final-image-inspect.log")"; then
  if [[ ! "${final_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "registry returned an invalid digest; refusing registry mutation" >&2
    exit 1
  fi
elif [[ "$(cat "${log_dir}/final-image-inspect.log")" == "ERROR: ${final_ref}: not found" ]]; then
  # This is Buildx's exact manifest-not-found response. Authentication failures,
  # unavailable registries, and unfamiliar errors must never mean absence.
  final_digest=""
else
  cat "${log_dir}/final-image-inspect.log" >&2
  echo "cannot establish final image state; refusing registry mutation" >&2
  exit 1
fi

lookup_exists=false
lookup_github() {
  local api_path="$1"
  local log_name="$2"
  local status_line
  lookup_exists=false
  if gh api --include "${api_path}" >"${log_dir}/${log_name}-response.log" 2>"${log_dir}/${log_name}-error.log"; then
    lookup_exists=true
  else
    IFS= read -r status_line < "${log_dir}/${log_name}-response.log" || true
    if [[ ! "${status_line}" =~ ^HTTP/[0-9.]+[[:space:]]404[[:space:]] ]]; then
      cat "${log_dir}/${log_name}-error.log" >&2
      echo "cannot establish ${log_name} state; refusing registry mutation" >&2
      exit 1
    fi
  fi
}

lookup_github "repos/${GITHUB_REPOSITORY}/releases/tags/${release_tag}" github-release
release_exists="${lookup_exists}"
lookup_github "repos/${GITHUB_REPOSITORY}/git/ref/tags/${release_tag}" github-tag
tag_exists="${lookup_exists}"

if [[ -z "${final_digest}" && ( "${release_exists}" == true || "${tag_exists}" == true ) ]]; then
  echo "GitHub Release or Git tag exists but ${final_ref} is missing; refusing registry mutation" >&2
  exit 1
fi
if [[ "${RELEASE_REQUIRE_ABSENT:-false}" == true && -n "${final_digest}" ]]; then
  echo "final image appeared after preflight; refusing to replace it during promotion" >&2
  exit 1
fi

source_verified=false
if [[ -n "${final_digest}" && "${release_exists}" != true ]]; then
  # Recovery may publish release metadata only when authenticated provenance
  # binds this existing digest to the exact source commit of this dispatch.
  if ! timeout 5m gh attestation verify "oci://${final_ref%:*}@${final_digest}" \
    --repo "${GITHUB_REPOSITORY}" \
    --signer-workflow "${GITHUB_REPOSITORY}/.github/workflows/release-image.yml" \
    --source-ref refs/heads/main \
    --source-digest "${GITHUB_SHA}" \
    >"${log_dir}/source-provenance-verify.log" 2>&1; then
    cat "${log_dir}/source-provenance-verify.log" >&2
    echo "refusing to attach this dispatch SHA to an older image without matching verified source provenance" >&2
    echo "dispatch the original verified source commit or supersede the candidate with a new version; never replace the existing tag" >&2
    exit 1
  fi
  if [[ "${tag_exists}" == true ]]; then
    if ! tag_identity="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${release_tag}" --jq '.object | "\(.type) \(.sha)"' 2>"${log_dir}/github-tag-identity-error.log")" || [[ "${tag_identity}" != "commit ${GITHUB_SHA}" ]]; then
      echo "existing release tag is not a lightweight tag at the verified source SHA; refusing release recovery" >&2
      exit 1
    fi
  fi
  source_verified=true
fi
if [[ -n "${final_digest}" && "${release_exists}" == true && "${tag_exists}" != true ]]; then
  echo "GitHub Release has no matching Git tag; refusing inconsistent release recovery" >&2
  exit 1
fi

if [[ -n "${final_digest}" ]]; then
  publish_required=false
  working_ref="${final_ref}"
  echo "found existing image ${final_ref}@${final_digest}; verification-only recovery mode"
else
  publish_required=true
  working_ref="${final_ref%:*}:candidate-${final_ref##*:}-${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  echo "confirmed final image and release are absent; staging reference ${working_ref}"
fi

{
  echo "publish_required=${publish_required}"
  echo "working_ref=${working_ref}"
  echo "final_digest=${final_digest}"
  echo "release_exists=${release_exists}"
  echo "tag_exists=${tag_exists}"
  echo "source_verified=${source_verified}"
} >> "${GITHUB_OUTPUT}"
