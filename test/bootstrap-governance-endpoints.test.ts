import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

const repository = "OMT-Global/github-runner-fleet";
const endpoints = ["repos/" + repository, "repos/" + repository + "/branches/main/protection"];
const labels = endpoints.map((endpoint) => "GitHub governance GET " + endpoint);
const token = "nonsecret-endpoint-test-token";
const bodyMarker = "nonsecret-response-body-marker";
const nl = String.fromCharCode(10);

function runChecker(failure: number, exitCode = 1, options: {
  verify?: string; token?: string; repository?: string; drift?: boolean; mismatch?: boolean;
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
    const repo = { default_branch: manifest.project.defaultBranch,
      allow_auto_merge: g.autoMerge, delete_branch_on_merge: g.deleteBranchOnMerge,
      allow_merge_commit: g.allowMergeCommit, allow_squash_merge: g.allowSquashMerge,
      allow_rebase_merge: g.allowRebaseMerge, has_issues: g.repoFeatures.hasIssues,
      has_projects: g.repoFeatures.hasProjects, has_wiki: g.repoFeatures.hasWiki,
      has_discussions: g.repoFeatures.hasDiscussions, diagnosticSentinel: bodyMarker };
    const protection = { required_linear_history: { enabled: g.enforceLinearHistory },
      required_pull_request_reviews: { required_approving_review_count: g.requiredApprovals,
        dismiss_stale_reviews: g.dismissStaleReviews, require_code_owner_reviews: g.requireCodeOwnerReviews,
        require_last_push_approval: g.requireLastPushApproval },
      required_status_checks: { contexts: g.requiredStatusChecks }, diagnosticSentinel: bodyMarker };
    if (options.mismatch) repo.allow_auto_merge = !g.autoMerge;
    fs.writeFileSync(path.join(root, "responses.json"), JSON.stringify([repo, protection]));
    const recorder = path.join(root, "requests.jsonl");
    const stub = ["#!" + process.execPath, 'import fs from "node:fs";',
      'const nl = String.fromCharCode(10); const p = process.env.DIAG_REQUESTS;',
      'const count = fs.existsSync(p) ? fs.readFileSync(p,"utf8").trim().split(nl).length : 0;',
      'fs.appendFileSync(p,JSON.stringify({argv:process.argv.slice(2),verify:process.env.VERIFY_GITHUB_GOVERNANCE,tokenUnchanged:process.env.GH_TOKEN==="' + token + '"})+nl);',
      'if (count+1 === Number(process.env.DIAG_FAILURE)) { console.error("gh: Resource not accessible by personal access token (HTTP 403)"); process.exit(Number(process.env.DIAG_EXIT)); }',
      'process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.env.DIAG_RESPONSES,"utf8"))[count]));'
    ].join(nl);
    // Sole gh on PATH, with no delegation or network operation.
    fs.writeFileSync(path.join(root, "gh"), stub, { mode: 0o755 });
    const env = { PATH: root + ":" + path.dirname(process.execPath) + ":/usr/bin:/bin",
      HOME: root, TMPDIR: root, LANG: "C.UTF-8", NODE_OPTIONS: "--max-old-space-size=3072",
      BOOTSTRAP_CLI: path.join(root, "dist/cli.js"), GH_TOKEN: options.token ?? token,
      VERIFY_GITHUB_GOVERNANCE: options.verify ?? "true", GITHUB_REPOSITORY: options.repository ?? repository,
      DIAG_REQUESTS: recorder, DIAG_RESPONSES: path.join(root, "responses.json"),
      DIAG_FAILURE: String(failure), DIAG_EXIT: String(exitCode) };
    const result = spawnSync("bash", ["scripts/ci/check-bootstrap-drift.sh"], {
      encoding: "utf8", env, timeout: 10000
    });
    expect(result.error).toBeUndefined();
    const requests = fs.existsSync(recorder) ? fs.readFileSync(recorder, "utf8").trim().split(nl).map((line) => JSON.parse(line)) : [];
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(token);
    expect(output).not.toContain(bodyMarker);
    expect(output).not.toMatch(/authorization|bearer|GH_TOKEN=/i);
    for (const request of requests) {
      expect(request.verify).toBe("true");
      expect(request.tokenUnchanged).toBe(true);
    }
    return { ...result, requests, output };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("bootstrap governance endpoint labels", () => {
  for (const failure of [1, 2]) {
    for (const exitCode of [1, 43]) {
      test("labels read " + failure + " before its failure and preserves exit " + exitCode, () => {
        const result = runChecker(failure, exitCode);
        expect(result.status).toBe(exitCode);
        expect(result.requests.map((request) => request.argv)).toEqual(endpoints.slice(0, failure).map((endpoint) => ["api", endpoint]));
        expect(result.stdout).toBe("bootstrap managed-file plan is empty" + nl + labels.slice(0, failure).join(nl) + nl);
        expect(result.stderr).toBe("gh: Resource not accessible by personal access token (HTTP 403)" + nl);
        expect(result.output).not.toContain("governance verification is disabled");
      });
    }
  }
  test("retains both reads in order and actual successful governance comparison", () => {
    const result = runChecker(0);
    expect(result.status).toBe(0);
    expect(result.requests.map((request) => request.argv)).toEqual(endpoints.map((endpoint) => ["api", endpoint]));
    expect(result.stdout).toBe("bootstrap managed-file plan is empty" + nl + labels.join(nl) + nl + "bootstrap GitHub governance matches live repository settings" + nl);
    expect(result.stderr).toBe("");
  });
  test("still rejects actual governance mismatch after both reads", () => {
    const result = runChecker(0, 1, { mismatch: true });
    expect(result.status).toBe(1);
    expect(result.requests).toHaveLength(2);
    expect(result.stderr).toContain("bootstrap GitHub governance drift detected");
  });
  for (const [name, options, status] of [
    ["disabled", { verify: "false" }, 0],
    ["missing token", { token: "" }, 1],
    ["missing repository", { repository: "" }, 1],
    ["managed drift", { drift: true }, 1]
  ] as const) {
    test("does not label or request when " + name, () => {
      const result = runChecker(0, 1, options);
      expect(result.status).toBe(status);
      expect(result.requests).toEqual([]);
      expect(result.output).not.toContain("GitHub governance GET");
    });
  }
});
