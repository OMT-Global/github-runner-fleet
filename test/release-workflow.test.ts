import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

const shellSafePublicRunner = ["self-hosted", "linux", "shell-only", "public"];

describe("release workflow", () => {
  test("publishes on shell-safe self-hosted runners, verifies the pushed tag, and can create a repo release from main", () => {
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
          "runs-on": string | string[];
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
    expect(workflow.on.push).toMatchObject({
      branches: ["main"]
    });
    expect(workflow.permissions).toMatchObject({
      contents: "write",
      packages: "write",
      "id-token": "write",
      attestations: "write"
    });
    expect(job["runs-on"]).toEqual(shellSafePublicRunner);
    expect(job.env).toMatchObject({
      GITHUB_PAT: "${{ secrets.GITHUB_TOKEN }}",
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/github-runner-fleet"
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
      steps.some((step) => step.uses === "sigstore/cosign-installer@v4.1.2")
    ).toBe(true);
    expect(steps.some((step) => step.uses === "anchore/sbom-action@v0")).toBe(true);
    expect(
      steps.some((step) => step.uses === "actions/attest-build-provenance@v3")
    ).toBe(true);
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
          step.name === "Sign image digest" &&
          typeof step.run === "string" &&
          step.run.includes("cosign sign")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          step.name === "Sign per-platform image digests" &&
          typeof step.run === "string" &&
          step.run.includes(".manifests[].digest") &&
          step.run.includes("cosign sign")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          step.name === "Verify image signature and attestations" &&
          typeof step.run === "string" &&
          step.run.includes("cosign verify") &&
          step.run.includes("cosign verify-attestation")
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
          step.name === "guard main branch before any publish" &&
          typeof step.run === "string" &&
          step.run.includes('GITHUB_REF_NAME') &&
          step.run.includes("main") &&
          step.run.includes("release-image may only publish from main")
      )
    ).toBe(true);
    const automaticPublishGuardIndex = steps.findIndex(
      (step) =>
        step.name === "guard automatic publish version" &&
        step.if === "${{ github.event_name == 'push' }}" &&
        typeof step.run === "string" &&
        step.run.includes("gh release view") &&
        step.run.includes("bump package.json and config/pools.yaml")
    );
    const imagePublishIndex = steps.findIndex(
      (step) =>
        typeof step.run === "string" &&
        step.run.includes("./scripts/build-image.sh") &&
        step.run.includes("--push")
    );
    expect(automaticPublishGuardIndex).toBeGreaterThan(-1);
    expect(imagePublishIndex).toBeGreaterThan(automaticPublishGuardIndex);
    expect(
      steps.filter(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("command -v pgrep") &&
          step.run.includes("docker --version") &&
          step.run.includes("terraform version")
      )
    ).toHaveLength(2);
    expect(
      steps.some(
        (step) =>
          step.if ===
            "${{ github.event_name == 'push' || inputs.publish_project_release }}" &&
          typeof step.run === "string" &&
          step.run.includes("gh release create") &&
          step.run.includes("--generate-notes")
      )
    ).toBe(true);
  });
});
