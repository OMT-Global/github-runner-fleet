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
    for (const fileName of ["rg-ci.yml", "rg-security.yml", "rg-release.yml"]) {
      const workflow = YAML.parse(
        fs.readFileSync(path.resolve(".github/workflows", fileName), "utf8")
      ) as { on: Record<string, unknown>; jobs: Record<string, Record<string, unknown>> };

      expect(workflow.on).toHaveProperty("workflow_call");
    }

    const rgCi = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/rg-ci.yml"), "utf8")
    ) as { jobs: Record<string, Record<string, unknown>> };
    expect(rgCi.jobs["shell-safe-public"]["runs-on"]).toEqual(shellSafePublicRunner);
    expect(rgCi.jobs.hosted["runs-on"]).toBe("ubuntu-24.04");

    const rgSecurity = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/rg-security.yml"), "utf8")
    ) as { on: Record<string, unknown>; jobs: Record<string, Record<string, unknown>> };

    expect(rgSecurity.on).toHaveProperty("workflow_call");
    for (const job of Object.values(rgSecurity.jobs)) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
    }
    const rgSecuritySteps = rgSecurity.jobs.security.steps as Array<{ uses?: string }>;
    const codeqlActionVersions = rgSecuritySteps
      .map((step) => step.uses)
      .filter((uses): uses is string => uses?.startsWith("github/codeql-action/") ?? false)
      .map((uses) => uses.split("@")[1]);
    expect(codeqlActionVersions).toEqual([
      "7188fc363630916deb702c7fdcf4e481b751f97a",
      "7188fc363630916deb702c7fdcf4e481b751f97a",
      "7188fc363630916deb702c7fdcf4e481b751f97a"
    ]);

    const codeqlSteps = rgSecurity.jobs.security.steps.filter((step: { uses?: string }) =>
      step.uses?.startsWith("github/codeql-action/")
    );
    const codeqlVersions = codeqlSteps.map((step: { uses: string }) => step.uses.split("@")[1]);
    expect(codeqlVersions).toHaveLength(3);
    expect(new Set(codeqlVersions)).toEqual(new Set(["7188fc363630916deb702c7fdcf4e481b751f97a"]));

    const rgRelease = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/rg-release.yml"), "utf8")
    ) as { jobs: Record<string, Record<string, unknown>> };
    expect(rgRelease.jobs.release["runs-on"]).toBe("ubuntu-24.04");
  });
});
