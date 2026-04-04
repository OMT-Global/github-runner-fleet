import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

describe("release workflow", () => {
  test("publishes on hosted runners, verifies the pushed tag, and can create a repo release from main", () => {
    const workflow = YAML.parse(
      fs.readFileSync(
        path.resolve(".github/workflows/release-image.yml"),
        "utf8"
      )
    ) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<
        string,
        {
          "runs-on": string;
          env: Record<string, string>;
          steps: Array<Record<string, unknown>>;
        }
      >;
    };

    const job = workflow.jobs.publish_and_verify;
    const steps = job.steps;
    const dispatch = workflow.on.workflow_dispatch as {
      inputs?: Record<string, { type?: string; default?: boolean }>;
    };

    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.permissions).toMatchObject({
      contents: "write",
      packages: "write"
    });
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.env).toMatchObject({
      GITHUB_PAT: "${{ secrets.GITHUB_TOKEN }}",
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/synology-github-runner"
    });
    expect(dispatch.inputs?.publish_project_release).toMatchObject({
      type: "boolean",
      default: false
    });

    expect(steps.some((step) => step.uses === "docker/setup-qemu-action@v4")).toBe(
      true
    );
    expect(steps.some((step) => step.uses === "docker/setup-buildx-action@v4")).toBe(
      true
    );
    expect(steps.some((step) => step.uses === "docker/login-action@v4")).toBe(true);
    expect(
      steps.some(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("./scripts/build-image.sh") &&
          step.run.includes("--push")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("docker buildx imagetools inspect") &&
          step.run.includes("linux/amd64") &&
          step.run.includes("linux/arm64")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("pnpm validate-image")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("package.json version") &&
          step.run.includes("config image tag")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          step.if === "${{ inputs.publish_project_release }}" &&
          typeof step.run === "string" &&
          step.run.includes('GITHUB_REF_NAME') &&
          step.run.includes("main")
      )
    ).toBe(true);
    expect(
      steps.filter(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("command -v pgrep") &&
          step.run.includes("terraform version")
      )
    ).toHaveLength(2);
    expect(
      steps.some(
        (step) =>
          step.if === "${{ inputs.publish_project_release }}" &&
          typeof step.run === "string" &&
          step.run.includes("gh release create") &&
          step.run.includes("--generate-notes")
      )
    ).toBe(true);
  });
});
