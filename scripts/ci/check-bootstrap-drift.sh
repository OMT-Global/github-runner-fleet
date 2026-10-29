#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bootstrap_cli="${BOOTSTRAP_CLI:?BOOTSTRAP_CLI must point to the pinned Bootstrap dist/cli.js}"
bootstrap_root="$(cd "$(dirname "${bootstrap_cli}")/.." && pwd)"
plan_file="$(mktemp)"
home_dir="$(mktemp -d)"
expected_file="$(mktemp)"
repo_file="$(mktemp)"
protection_file="$(mktemp)"
graphql_file="$(mktemp)"
trap 'rm -f "${plan_file}" "${expected_file}" "${repo_file}" "${protection_file}" "${graphql_file}"; rm -rf "${home_dir}"' EXIT

# Managed-file drift is local; the aggregate CLI plan also queries GitHub.
# Keep governance API reads in the explicit verification block below.
node --input-type=module - "${bootstrap_root}" "${repo_root}" > "${plan_file}" <<'NODE'
import { pathToFileURL } from "node:url";
const [bootstrapRoot, repoRoot] = process.argv.slice(2);
const { loadManifest } = await import(pathToFileURL(`${bootstrapRoot}/dist/manifest.js`));
const { planRepo } = await import(pathToFileURL(`${bootstrapRoot}/dist/render.js`));
const manifest = await loadManifest(`${repoRoot}/project.bootstrap.yaml`);
const plan = await planRepo(manifest, repoRoot);
console.log(JSON.stringify({ repo: plan.changes }));
NODE

node --input-type=module - "${plan_file}" <<'NODE'
import fs from "node:fs";

const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(plan.repo)) {
  throw new Error("bootstrap plan did not return a repository change array");
}
const drift = plan.repo.filter((change) => change.type !== "unchanged");
if (drift.length > 0) {
  console.error("bootstrap-managed repository drift detected:");
  console.error(JSON.stringify(drift, null, 2));
  process.exit(1);
}
console.log("bootstrap managed-file plan is empty");
NODE

if [[ "${VERIFY_GITHUB_GOVERNANCE:-false}" != "true" ]]; then
  echo "trusted GitHub governance verification is disabled; managed-file drift check complete"
  exit 0
fi
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "GITHUB_REPOSITORY is required when VERIFY_GITHUB_GOVERNANCE=true" >&2
  exit 1
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN is required when VERIFY_GITHUB_GOVERNANCE=true" >&2
  exit 1
fi

node - "${bootstrap_root}/node_modules/yaml" "${repo_root}/project.bootstrap.yaml" > "${expected_file}" <<'NODE'
const fs = require("node:fs");
const YAML = require(process.argv[2]);
const manifest = YAML.parse(fs.readFileSync(process.argv[3], "utf8"));
process.stdout.write(JSON.stringify({
  defaultBranch: manifest.project.defaultBranch,
  autoMerge: manifest.github.autoMerge,
  deleteBranchOnMerge: manifest.github.deleteBranchOnMerge,
  allowMergeCommit: manifest.github.allowMergeCommit,
  allowSquashMerge: manifest.github.allowSquashMerge,
  allowRebaseMerge: manifest.github.allowRebaseMerge,
  enforceLinearHistory: manifest.github.enforceLinearHistory,
  requiredApprovals: manifest.github.requiredApprovals,
  dismissStaleReviews: manifest.github.dismissStaleReviews,
  requireCodeOwnerReviews: manifest.github.requireCodeOwnerReviews,
  requireLastPushApproval: manifest.github.requireLastPushApproval,
  requiredStatusChecks: [...manifest.github.requiredStatusChecks].sort(),
  repoFeatures: manifest.github.repoFeatures
}));
NODE

printf 'GitHub governance GET repos/%s\n' "${GITHUB_REPOSITORY}"
gh api "repos/${GITHUB_REPOSITORY}" > "${repo_file}"
default_branch="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).defaultBranch)' "${expected_file}")"
printf 'GitHub governance GET repos/%s/branches/%s/protection\n' "${GITHUB_REPOSITORY}" "${default_branch}"
gh api "repos/${GITHUB_REPOSITORY}/branches/${default_branch}/protection" > "${protection_file}"

printf 'GitHub governance GraphQL repository settings repos/%s\n' "${GITHUB_REPOSITORY}"
gh api graphql -f query='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { nameWithOwner autoMergeAllowed deleteBranchOnMerge mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed } }' -f owner="${GITHUB_REPOSITORY%%/*}" -f name="${GITHUB_REPOSITORY#*/}" > "${graphql_file}"

node --input-type=module - "${expected_file}" "${repo_file}" "${protection_file}" "${graphql_file}" "${GITHUB_REPOSITORY}" <<'NODE'
import fs from "node:fs";

const [expectedPath, repoPath, protectionPath, graphqlPath, repository] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
const repo = JSON.parse(fs.readFileSync(repoPath, "utf8"));
const protection = JSON.parse(fs.readFileSync(protectionPath, "utf8"));
function unreadableSettings() {
  console.error("bootstrap GitHub governance repository settings are unreadable");
  process.exit(1);
}
let graphql;
try {
  graphql = JSON.parse(fs.readFileSync(graphqlPath, "utf8"));
} catch {
  unreadableSettings();
}
if (!graphql || typeof graphql !== "object" || Array.isArray(graphql)) unreadableSettings();
const invalidErrors = Object.hasOwn(graphql, "errors") && (!Array.isArray(graphql.errors) || graphql.errors.length > 0);
const settings = graphql.data?.repository;
const settingFields = ["autoMergeAllowed", "deleteBranchOnMerge", "mergeCommitAllowed", "squashMergeAllowed", "rebaseMergeAllowed"];
const wrongRepository = settings?.nameWithOwner !== repository;
if (invalidErrors || !settings || typeof settings !== "object" || Array.isArray(settings) || wrongRepository ||
    settingFields.some((field) => typeof settings[field] !== "boolean")) {
  unreadableSettings();
}
const actual = {
  defaultBranch: repo.default_branch,
  autoMerge: settings.autoMergeAllowed,
  deleteBranchOnMerge: settings.deleteBranchOnMerge,
  allowMergeCommit: settings.mergeCommitAllowed,
  allowSquashMerge: settings.squashMergeAllowed,
  allowRebaseMerge: settings.rebaseMergeAllowed,
  enforceLinearHistory: protection.required_linear_history?.enabled ?? false,
  requiredApprovals: protection.required_pull_request_reviews?.required_approving_review_count ?? 0,
  dismissStaleReviews: protection.required_pull_request_reviews?.dismiss_stale_reviews ?? false,
  requireCodeOwnerReviews: protection.required_pull_request_reviews?.require_code_owner_reviews ?? false,
  requireLastPushApproval: protection.required_pull_request_reviews?.require_last_push_approval ?? false,
  requiredStatusChecks: (protection.required_status_checks?.contexts ?? []).sort(),
  repoFeatures: {
    hasIssues: repo.has_issues,
    hasProjects: repo.has_projects,
    hasWiki: repo.has_wiki,
    hasDiscussions: repo.has_discussions
  }
};
const mismatches = Object.keys(expected).filter(
  (key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key])
);
if (mismatches.length > 0) {
  console.error("bootstrap GitHub governance drift detected:");
  for (const key of mismatches) {
    console.error(`${key}: expected=${JSON.stringify(expected[key])} actual=${JSON.stringify(actual[key])}`);
  }
  process.exit(1);
}
console.log("bootstrap GitHub governance matches live repository settings");
NODE
