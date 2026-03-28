import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

describe("CI workflow", () => {
  test("keeps trusted shell jobs on the public self-hosted runner contract", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const trustedJob = workflow.jobs.test_self_hosted_trusted;
    const steps = trustedJob.steps as Array<Record<string, unknown>>;
    const setupNodeStep = steps.find(
      (step) => step.uses === "actions/setup-node@v6"
    );

    expect(trustedJob["runs-on"]).toEqual([
      "self-hosted",
      "synology",
      "shell-only",
      "public"
    ]);
    expect(trustedJob.env).toMatchObject({
      RUNNER_TEMP: "/tmp/github-runner-temp",
      RUNNER_TOOL_CACHE: "/opt/hostedtoolcache",
      AGENT_TOOLSDIRECTORY: "/opt/hostedtoolcache"
    });
    expect(setupNodeStep).toBeDefined();
    expect(setupNodeStep?.with).toMatchObject({
      "node-version": "24",
      cache: "pnpm"
    });
    expect(JSON.stringify(steps)).not.toContain("https://nodejs.org/dist/");
  });

  test("keeps fork pull requests on GitHub-hosted runners", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    expect(workflow.jobs.test_public_fork_pr["runs-on"]).toBe("ubuntu-latest");
  });
});
