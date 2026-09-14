import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

describe("bootstrap governance sources", () => {
  test("keeps package manager, reviewers, and CODEOWNERS aligned", () => {
    const manifest = YAML.parse(read("project.bootstrap.yaml")) as {
      archetype: { packageManager: string };
      github: {
        reviewers: string[];
        codeowners: Array<{ pattern: string; owners: string[] }>;
      };
    };

    expect(manifest.archetype.packageManager).toBe("pnpm");
    expect(manifest.github.reviewers).toEqual(["OMT-Global/omt-codeowners"]);
    expect(manifest.github.codeowners).toEqual([
      { pattern: "*", owners: ["@OMT-Global/omt-codeowners"] }
    ]);
    expect(read("CODEOWNERS")).toBe(read(".github/CODEOWNERS"));
  });

  test("does not advertise completed legacy roadmap work as future work", () => {
    const futureDocs = `${read("README.md")}\n${read("ROADMAP.md")}`;
    for (const issue of [26, 27, 28, 29]) {
      expect(futureDocs).not.toContain(`/issues/${issue}`);
    }
  });

  test("local drift never invokes the aggregate CLI or GitHub with governance disabled", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-local-plan-"));
    try {
      fs.mkdirSync(path.join(root, "dist"));
      fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
      fs.writeFileSync(path.join(root, "dist/cli.js"), 'throw Error("aggregate planner invoked");');
      fs.writeFileSync(path.join(root, "dist/manifest.js"), 'export async function loadManifest() { return {}; }');
      fs.writeFileSync(path.join(root, "dist/render.js"), 'export async function planRepo() { return {changes: []}; }');
      fs.writeFileSync(path.join(root, "gh"), '#!/bin/sh\nexit 97\n', { mode: 0o755 });
      const run = () => spawnSync("bash", ["scripts/ci/check-bootstrap-drift.sh"], {
        encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH}`,
          BOOTSTRAP_CLI: path.join(root, "dist/cli.js"), GH_TOKEN: "nonsecret-test-token",
          VERIFY_GITHUB_GOVERNANCE: "false" }
      });
      expect(run().status).toBe(0);
      fs.writeFileSync(path.join(root, "dist/render.js"), 'export async function planRepo() { return {changes: [{path:"project.bootstrap.yaml",type:"update"}]}; }');
      const drift = run();
      expect(drift.status).toBe(1);
      expect(drift.stderr).toContain("bootstrap-managed repository drift detected");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("pins a non-mutating bootstrap drift check", () => {
    const workflow = read(".github/workflows/extended-validation.yml");
    const script = read("scripts/ci/check-bootstrap-drift.sh");
    expect(workflow).toContain("Bootstrap Drift");
    expect(workflow).toContain("99455ebc120bc91987ee2f7f9a7c097ae73021dc");
    expect(script).toContain("await planRepo(manifest, repoRoot)");
    expect(script).not.toContain('node "${bootstrap_cli}" plan');
    expect(script).toContain('change.type !== "unchanged"');
    expect(script).toContain('gh api "repos/${GITHUB_REPOSITORY}"');
    expect(script).toContain('VERIFY_GITHUB_GOVERNANCE:-false');
    expect(script).toContain("bootstrap GitHub governance drift detected");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
