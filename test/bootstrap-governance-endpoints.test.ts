import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

const repository = "OMT-Global/github-runner-fleet";
const query = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { nameWithOwner autoMergeAllowed deleteBranchOnMerge mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed } }";
const graphqlArgs = ["api", "graphql", "-f", "query=" + query, "-f", "owner=OMT-Global", "-f", "name=github-runner-fleet"];
const requests = [["api", "repos/" + repository], ["api", "repos/" + repository + "/branches/main/protection"], graphqlArgs];
const labels = ["GitHub governance GET repos/" + repository,
  "GitHub governance GET repos/" + repository + "/branches/main/protection",
  "GitHub governance GraphQL repository settings repos/" + repository];
const token = "nonsecret-endpoint-test-token";
const bodyMarker = "nonsecret-response-body-marker";
const nl = String.fromCharCode(10);
const settingPairs = [
  ["autoMerge", "autoMergeAllowed", "allow_auto_merge"],
  ["deleteBranchOnMerge", "deleteBranchOnMerge", "delete_branch_on_merge"],
  ["allowMergeCommit", "mergeCommitAllowed", "allow_merge_commit"],
  ["allowSquashMerge", "squashMergeAllowed", "allow_squash_merge"],
  ["allowRebaseMerge", "rebaseMergeAllowed", "allow_rebase_merge"]
] as const;

function qualifiedResponse() {
  // Explicit boolean shape qualified independently; REST may omit these five fields.
  return { data: { repository: { nameWithOwner: repository, autoMergeAllowed: true,
    deleteBranchOnMerge: true, mergeCommitAllowed: true, squashMergeAllowed: true,
    rebaseMergeAllowed: true } } };
}

function runChecker(failure: number, exitCode = 1, options: {
  verify?: string; token?: string; repository?: string; drift?: boolean; mismatch?: boolean;
  graphql?: unknown; rawGraphql?: string; expectedFalse?: (typeof settingPairs)[number][0];
  includeRestSettings?: boolean; restMismatch?: "defaultBranch" | "hasIssues" | "linearHistory";
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-endpoint-"));
  try {
    fs.mkdirSync(path.join(root, "dist"));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.symlinkSync(path.resolve("node_modules/yaml"), path.join(root, "node_modules/yaml"), "dir");
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(root, "dist/cli.js"), 'throw Error("aggregate CLI must not run");');
    fs.writeFileSync(path.join(root, "dist/manifest.js"), 'export async function loadManifest() { return {}; }');
    fs.writeFileSync(path.join(root, "dist/render.js"), "export async function planRepo() { return {changes: " +
      (options.drift ? '[{path:"project.bootstrap.yaml",type:"update"}]' : "[]") + "}; }");
    const manifest = YAML.parse(fs.readFileSync("project.bootstrap.yaml", "utf8"));
    const g = manifest.github;
    const response = Object.hasOwn(options, "graphql") ? options.graphql : qualifiedResponse();
    if (options.expectedFalse) {
      g[options.expectedFalse] = false;
      const pair = settingPairs.find(([key]) => key === options.expectedFalse)!;
      (response as ReturnType<typeof qualifiedResponse>).data.repository[pair[1]] = false;
    }
    if (options.mismatch) (response as ReturnType<typeof qualifiedResponse>).data.repository.autoMergeAllowed = !g.autoMerge;
    const repo: Record<string, unknown> = { default_branch: manifest.project.defaultBranch,
      has_issues: g.repoFeatures.hasIssues, has_projects: g.repoFeatures.hasProjects,
      has_wiki: g.repoFeatures.hasWiki, has_discussions: g.repoFeatures.hasDiscussions,
      diagnosticSentinel: bodyMarker };
    if (options.includeRestSettings) for (const [key, , restKey] of settingPairs) repo[restKey] = !g[key];
    const protection = { required_linear_history: { enabled: g.enforceLinearHistory },
      required_pull_request_reviews: { required_approving_review_count: g.requiredApprovals,
        dismiss_stale_reviews: g.dismissStaleReviews, require_code_owner_reviews: g.requireCodeOwnerReviews,
        require_last_push_approval: g.requireLastPushApproval },
      required_status_checks: { contexts: g.requiredStatusChecks }, diagnosticSentinel: bodyMarker };
    if (options.restMismatch === "defaultBranch") repo.default_branch = "other-branch";
    if (options.restMismatch === "hasIssues") repo.has_issues = !g.repoFeatures.hasIssues;
    if (options.restMismatch === "linearHistory") protection.required_linear_history.enabled = !g.enforceLinearHistory;
    const repoRoot = path.join(root, "repo");
    const checker = path.join(repoRoot, "scripts/ci/check-bootstrap-drift.sh");
    fs.mkdirSync(path.dirname(checker), { recursive: true });
    // Execute a byte-exact copy of the actual on-disk checker with an isolated manifest.
    fs.copyFileSync("scripts/ci/check-bootstrap-drift.sh", checker);
    fs.writeFileSync(path.join(repoRoot, "project.bootstrap.yaml"), YAML.stringify(manifest));
    fs.writeFileSync(path.join(root, "responses.json"), JSON.stringify([repo, protection, response]));
    const recorder = path.join(root, "requests.jsonl");
    const stub = ["#!" + process.execPath, 'import fs from "node:fs";',
      'const nl = String.fromCharCode(10); const p = process.env.DIAG_REQUESTS;',
      'const count = fs.existsSync(p) ? fs.readFileSync(p,"utf8").trim().split(nl).length : 0;',
      'fs.appendFileSync(p,JSON.stringify({argv:process.argv.slice(2),verify:process.env.VERIFY_GITHUB_GOVERNANCE,tokenUnchanged:process.env.GH_TOKEN==="' + token + '"})+nl);',
      'if (count+1 === Number(process.env.DIAG_FAILURE)) { console.error("gh: Resource not accessible by personal access token (HTTP 403)"); process.exit(Number(process.env.DIAG_EXIT)); }',
      'if (count === 2 && process.env.DIAG_RAW_GRAPHQL) { process.stdout.write(process.env.DIAG_RAW_GRAPHQL); process.exit(0); }',
      'process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.env.DIAG_RESPONSES,"utf8"))[count]));'
    ].join(nl);
    // Sole gh on PATH, with no delegation or network operation.
    fs.writeFileSync(path.join(root, "gh"), stub, { mode: 0o755 });
    const env = { PATH: root + ":" + path.dirname(process.execPath) + ":/usr/bin:/bin",
      HOME: root, TMPDIR: root, LANG: "C.UTF-8", NODE_OPTIONS: "--max-old-space-size=3072",
      BOOTSTRAP_CLI: path.join(root, "dist/cli.js"), GH_TOKEN: options.token ?? token,
      VERIFY_GITHUB_GOVERNANCE: options.verify ?? "true", GITHUB_REPOSITORY: options.repository ?? repository,
      DIAG_REQUESTS: recorder, DIAG_RESPONSES: path.join(root, "responses.json"),
      DIAG_FAILURE: String(failure), DIAG_EXIT: String(exitCode), DIAG_RAW_GRAPHQL: options.rawGraphql ?? "" };
    const result = spawnSync("bash", [checker], { encoding: "utf8", env, timeout: 10000 });
    expect(result.error).toBeUndefined();
    const recorded = fs.existsSync(recorder) ? fs.readFileSync(recorder, "utf8").trim().split(nl).map((line) => JSON.parse(line)) : [];
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(token);
    expect(output).not.toContain(bodyMarker);
    expect(output).not.toMatch(/authorization|bearer|GH_TOKEN=/i);
    expect(fs.readdirSync(root).filter((name) => name.startsWith("tmp."))).toEqual([]);
    for (const request of recorded) {
      expect(request.verify).toBe("true");
      expect(request.tokenUnchanged).toBe(true);
    }
    return { ...result, requests: recorded, output };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("bootstrap governance endpoint labels", () => {
  for (const failure of [1, 2, 3]) {
    for (const exitCode of [1, 43]) {
      test("labels read " + failure + " before its failure and preserves exit " + exitCode, () => {
        const result = runChecker(failure, exitCode);
        expect(result.status).toBe(exitCode);
        expect(result.requests.map((request) => request.argv)).toEqual(requests.slice(0, failure));
        expect(result.stdout).toBe("bootstrap managed-file plan is empty" + nl + labels.slice(0, failure).join(nl) + nl);
        expect(result.stderr).toBe("gh: Resource not accessible by personal access token (HTTP 403)" + nl);
        expect(result.output).not.toContain("governance verification is disabled");
      });
    }
  }
  test("reads all five settings from qualified GraphQL after REST omits them", () => {
    const result = runChecker(0);
    expect(result.status, result.output).toBe(0);
    expect(result.requests.map((request) => request.argv)).toEqual(requests);
    expect(result.stdout).toBe("bootstrap managed-file plan is empty" + nl + labels.join(nl) + nl + "bootstrap GitHub governance matches live repository settings" + nl);
    expect(result.stderr).toBe("");
  });
  test("still rejects actual governance mismatch after all three reads", () => {
    const result = runChecker(0, 1, { mismatch: true });
    expect(result.status).toBe(1);
    expect(result.requests.map((request) => request.argv)).toEqual(requests);
    expect(result.stderr).toContain("bootstrap GitHub governance drift detected");
  });
  for (const [name, options, status] of [
    ["disabled", { verify: "false" }, 0], ["missing token", { token: "" }, 1],
    ["missing repository", { repository: "" }, 1], ["managed drift", { drift: true }, 1]
  ] as const) {
    test("does not label or request when " + name, () => {
      const result = runChecker(0, 1, options);
      expect(result.status).toBe(status);
      expect(result.requests).toEqual([]);
      expect(result.output).not.toContain("GitHub governance GET");
      expect(result.output).not.toContain("GitHub governance GraphQL");
    });
  }
});

describe("GraphQL repository settings fail closed", () => {
  for (const [key, field] of settingPairs) {
    test(field + " false is a real mismatch against expected true", () => {
      const response = qualifiedResponse(); response.data.repository[field] = false;
      const result = runChecker(0, 1, { graphql: response });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(key + ": expected=true actual=false");
    });
    test(field + " accepts explicit false when the manifest expects false", () => {
      expect(runChecker(0, 1, { expectedFalse: key }).status).toBe(0);
    });
    for (const [kind, value] of [["missing", undefined], ["null", null], ["string", "true"], ["number", 1], ["object", {}], ["array", []]] as const) {
      test(field + " rejects " + kind + " without treating it as false or default", () => {
        const response = qualifiedResponse();
        const settings = response.data.repository as Record<string, unknown>;
        if (kind === "missing") delete settings[field]; else settings[field] = value;
        const result = runChecker(0, 1, { graphql: response });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("bootstrap GitHub governance repository settings are unreadable");
      });
    }
  }
  const valid = qualifiedResponse();
  for (const [name, response] of [
    ["HTTP200 GraphQL errors with complete data", { ...valid, errors: [{ message: bodyMarker }] }],
    ["HTTP200 errors without data", { errors: [{ message: bodyMarker }] }],
    ["malformed errors", { ...valid, errors: null }], ["null response", null],
    ["missing data", {}], ["null data", { data: null }],
    ["missing repository", { data: {} }], ["null repository", { data: { repository: null } }],
    ["partial repository", { data: { repository: { nameWithOwner: repository } } }],
    ["identity mismatch", { data: { repository: { ...valid.data.repository, nameWithOwner: "Other/repository" } } }],
    ["missing identity", { data: { repository: { ...valid.data.repository, nameWithOwner: undefined } } }]
  ] as const) {
    test("rejects " + name, () => {
      const result = runChecker(0, 1, { graphql: response });
      expect(result.status).toBe(1);
      expect(result.requests.map((request) => request.argv)).toEqual(requests);
      expect(result.stderr).toContain("bootstrap GitHub governance repository settings are unreadable");
    });
  }
  test("rejects malformed GraphQL JSON without printing the response body", () => {
    const result = runChecker(0, 1, { rawGraphql: bodyMarker + " {" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bootstrap GitHub governance repository settings are unreadable");
  });
  test("accepts an explicitly empty errors array with complete boolean data", () => {
    expect(runChecker(0, 1, { graphql: { ...qualifiedResponse(), errors: [] } }).status).toBe(0);
  });
  test("uses GraphQL values even if legacy REST settings disagree", () => {
    expect(runChecker(0, 1, { includeRestSettings: true }).status).toBe(0);
  });
  for (const restMismatch of ["defaultBranch", "hasIssues", "linearHistory"] as const) {
    test("retains REST comparison for " + restMismatch, () => {
      const result = runChecker(0, 1, { restMismatch });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("bootstrap GitHub governance drift detected");
    });
  }
});
