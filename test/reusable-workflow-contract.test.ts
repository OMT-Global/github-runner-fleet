import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

const reusableFiles = ["rg-ci.yml", "rg-security.yml", "rg-release.yml"];

describe("reusable workflow consumer contract", () => {
  test("pins every external action to a full commit SHA", () => {
    for (const file of reusableFiles) {
      const document = YAML.parse(read(`.github/workflows/${file}`)) as {
        jobs: Record<string, { steps?: Array<{ uses?: string }> }>;
      };
      const uses = Object.values(document.jobs)
        .flatMap((job) => job.steps ?? [])
        .flatMap((step) => step.uses ? [step.uses] : []);
      expect(uses.length, file).toBeGreaterThan(0);
      for (const action of uses) {
        expect(action, `${file}: ${action}`).toMatch(/^[^@]+@[0-9a-f]{40}$/);
      }
    }
  });

  test("routes privileged and untrusted-safe lanes to hosted runners", () => {
    const security = parse("rg-security.yml");
    const release = parse("rg-release.yml");
    const ci = parse("rg-ci.yml");
    expect(security.jobs.security["runs-on"]).toBe("ubuntu-24.04");
    expect(release.jobs.release["runs-on"]).toBe("ubuntu-24.04");
    expect(ci.jobs.hosted["runs-on"]).toBe("ubuntu-24.04");
    expect(ci.jobs["shell-safe-public"]["runs-on"]).toEqual([
      "self-hosted", "linux", "shell-only", "public"
    ]);
  });

  test("calls all three workflows from a real smoke caller", () => {
    const smoke = YAML.parse(read(".github/workflows/reusable-workflow-smoke.yml")) as {
      jobs: Record<string, { uses: string; with?: Record<string, unknown> }>;
    };
    expect(smoke.jobs.ci.uses).toBe("./.github/workflows/rg-ci.yml");
    expect(smoke.jobs.security.uses).toBe("./.github/workflows/rg-security.yml");
    expect(smoke.jobs.security.with?.["enable-dependency-review"]).toBe(false);
    expect(smoke.jobs.security.with?.["enforce-osv"]).toBe(false);
    expect(smoke.jobs.release.uses).toBe("./.github/workflows/rg-release.yml");
    expect(smoke.jobs.release.with?.publish).toBe(false);
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("uses: ./.github/workflows/rg-ci.yml");
    expect(ci).toContain("uses: ./.github/workflows/rg-security.yml");
    expect(ci).toContain("uses: ./.github/workflows/rg-release.yml");
    expect(ci).toContain("reusable_contract_changes");
  });

  test("documents only the planned immutable release reference", () => {
    const cookbook = read("docs/workflow-cookbook.md");
    expect(cookbook).not.toContain("@v1");
    for (const file of reusableFiles) {
      expect(cookbook).toContain(`/.github/workflows/${file}@v0.2.3`);
    }
  });
});

function parse(file: string): { jobs: Record<string, Record<string, unknown>> } {
  return YAML.parse(read(`.github/workflows/${file}`));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
