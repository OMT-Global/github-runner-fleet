import fs from "node:fs";
import path from "node:path";
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

  test("pins a non-mutating bootstrap drift check", () => {
    const workflow = read(".github/workflows/extended-validation.yml");
    const script = read("scripts/ci/check-bootstrap-drift.sh");
    expect(workflow).toContain("Bootstrap Drift");
    expect(workflow).toContain("35eb9a907bb53f9bcf771a1435b72f17a7c7ad0c");
    expect(script).toContain('node "${bootstrap_cli}" plan');
    expect(script).toContain('change.type !== "unchanged"');
    expect(script).toContain('gh api "repos/${GITHUB_REPOSITORY}"');
    expect(script).toContain('VERIFY_GITHUB_GOVERNANCE:-false');
    expect(script).toContain("bootstrap GitHub governance drift detected");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
