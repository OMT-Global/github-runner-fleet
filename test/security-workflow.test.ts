import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

const shellSafePublicRunner = ["self-hosted", "linux", "shell-only", "public"];

describe("security and reusable workflows", () => {
  test("keeps security scans on GitHub-hosted runners with Security tab upload", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/security.yml"), "utf8")
    ) as { permissions: Record<string, string>; jobs: Record<string, Record<string, unknown>> };

    expect(workflow.permissions).toMatchObject({
      contents: "read",
      "security-events": "write"
    });
    for (const job of Object.values(workflow.jobs)) {
      expect(job["runs-on"]).toBe("ubuntu-latest");
    }
    expect(String(JSON.stringify(workflow))).toContain("github/codeql-action/init");
    expect(String(JSON.stringify(workflow))).toContain("dependency-review-action");
    expect(String(JSON.stringify(workflow))).toContain("osv-scanner/releases/download");
    expect(String(JSON.stringify(workflow))).toContain("upload-sarif");
    expect(workflow.jobs.osv.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Run OSV Scanner",
          "continue-on-error": true
        })
      ])
    );
  });

  test("publishes scorecard without adding a PR-required workflow", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/scorecard.yml"), "utf8")
    ) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Record<string, unknown>> };

    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.scorecard.permissions).toMatchObject({
      "id-token": "write",
      "security-events": "write"
    });
    expect(workflow.jobs.scorecard["runs-on"]).toBe("ubuntu-latest");
    expect(String(JSON.stringify(workflow))).toContain(
      "ossf/scorecard-action@v2.4.3"
    );
    expect(String(JSON.stringify(workflow))).toContain("publish_results");
  });

  test("exposes rg-ci, rg-security, and rg-release as workflow_call artifacts", () => {
    for (const fileName of ["rg-ci.yml", "rg-release.yml"]) {
      const workflow = YAML.parse(
        fs.readFileSync(path.resolve(".github/workflows", fileName), "utf8")
      ) as { on: Record<string, unknown>; jobs: Record<string, Record<string, unknown>> };

      expect(workflow.on).toHaveProperty("workflow_call");
      for (const job of Object.values(workflow.jobs)) {
        expect(job["runs-on"]).toEqual(shellSafePublicRunner);
      }
    }

    const rgSecurity = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/rg-security.yml"), "utf8")
    ) as { on: Record<string, unknown>; jobs: Record<string, Record<string, unknown>> };

    expect(rgSecurity.on).toHaveProperty("workflow_call");
    for (const job of Object.values(rgSecurity.jobs)) {
      expect(job["runs-on"]).toBe("ubuntu-latest");
    }
  });
});
