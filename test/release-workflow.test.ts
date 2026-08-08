import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

describe("release workflow", () => {
  test("publishes transactionally from explicit dispatch and can recover an existing digest", () => {
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
    expect(workflow.on).not.toHaveProperty("push");
    expect(workflow.permissions).toMatchObject({
      contents: "write",
      packages: "write",
      "id-token": "write",
      attestations: "write"
    });
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.env).toMatchObject({
      GITHUB_PAT: "${{ secrets.GITHUB_TOKEN }}",
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/github-runner-fleet"
    });
    expect(dispatch.inputs?.publish_project_release).toMatchObject({
      type: "boolean",
      default: true
    });

    expect(steps.some((step) => step.uses === "docker/setup-qemu-action@v4")).toBe(
      true
    );
    expect(steps.some((step) => step.uses === "docker/setup-buildx-action@v4")).toBe(
      true
    );
    expect(steps.some((step) => step.uses === "docker/login-action@v4.6.0")).toBe(true);
    expect(
      steps.some((step) => step.uses === "sigstore/cosign-installer@v4.1.2")
    ).toBe(true);
    expect(steps.some((step) => step.uses === "anchore/sbom-action@v0")).toBe(true);
    expect(
      steps.some((step) => step.uses === "actions/attest-build-provenance@v4")
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("image_ref=${config.image.repository}:${config.image.tag}") &&
          step.run.includes("image_repo=${config.image.repository}")
      )
    ).toBe(true);
    expect(
      steps.some(
        (step) =>
          step.name === "Enforce runner release freshness" &&
          step.run === "pnpm check-runner-version -- --fail-after-days 21"
      )
    ).toBe(true);
    expect(
      steps.filter(
        (step) =>
          typeof step.run === "string" &&
          step.run.includes("Runner.Listener --version") &&
          step.run.includes("cat /.runner-version")
      )
    ).toHaveLength(2);
    expect(
      steps.some(
        (step) =>
          step.name === "Emit SLSA provenance" &&
          step.with &&
          (step.with as Record<string, unknown>)["subject-name"] ===
            "${{ steps.release_meta.outputs.image_repo }}" &&
          (step.with as Record<string, unknown>)["subject-digest"] ===
            "${{ steps.image_digest.outputs.digest }}"
      )
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
    const perPlatformSignIndex = steps.findIndex(
      (step) => step.name === "Sign per-platform image digests"
    );
    const perPlatformSignStep = steps[perPlatformSignIndex];
    expect(perPlatformSignIndex).toBeGreaterThan(-1);
    expect(String(perPlatformSignStep?.run)).toContain(
      "steps.release_state.outputs.working_ref"
    );
    expect(String(perPlatformSignStep?.run)).toContain(
      "steps.image_digest.outputs.digest"
    );
    expect(String(perPlatformSignStep?.run)).not.toContain(
      "steps.release_meta.outputs.image_ref"
    );
    expect(String(perPlatformSignStep?.run)).toContain(".manifests[].digest");
    expect(String(perPlatformSignStep?.run)).toContain("cosign sign");
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
    const releasePreflightIndex = steps.findIndex(
      (step) =>
        step.name === "Preflight immutable release state" &&
        typeof step.run === "string" &&
        step.run.includes("candidate-") &&
        step.run.includes("verification-only recovery mode") &&
        step.run.includes("refusing registry mutation")
    );
    const imagePublishIndex = steps.findIndex(
      (step) =>
        typeof step.run === "string" &&
        step.run.includes("./scripts/build-image.sh") &&
        step.run.includes("--push")
    );
    expect(releasePreflightIndex).toBeGreaterThan(-1);
    expect(imagePublishIndex).toBeGreaterThan(releasePreflightIndex);
    const verifyIndex = steps.findIndex(
      (step) => step.name === "Verify image signature and attestations"
    );
    const promoteIndex = steps.findIndex(
      (step) => step.name === "Promote verified digest to final tag"
    );
    expect(String(steps[verifyIndex]?.run)).toContain("timeout 5m cosign verify");
    expect(String(steps[verifyIndex]?.run)).toContain(
      "timeout 5m cosign verify-attestation"
    );
    expect(perPlatformSignIndex).toBeLessThan(promoteIndex);
    expect(promoteIndex).toBeGreaterThan(verifyIndex);
    expect(String(steps[promoteIndex]?.run)).toContain(
      "docker buildx imagetools create"
    );
    expect(
      steps.some(
        (step) =>
          step.name === "Preserve verification diagnostics" &&
          step.if === "${{ failure() }}" &&
          step.uses === "actions/upload-artifact@v7"
      )
    ).toBe(true);
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
          step.if === "${{ inputs.publish_project_release }}" &&
          typeof step.run === "string" &&
          step.run.includes("gh release create") &&
          step.run.includes("--generate-notes") &&
          step.run.includes("verification completed without mutation")
      )
    ).toBe(true);
  });
});
