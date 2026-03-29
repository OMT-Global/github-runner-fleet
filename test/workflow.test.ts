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
    const installNodeStep = steps.find(
      (step) => step.uses === "./actions/setup-shell-safe-node"
    );
    const forkSteps = workflow.jobs.test_public_fork_pr.steps as Array<
      Record<string, unknown>
    >;
    const forkSetupNodeStep = forkSteps.find(
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
    expect(installNodeStep).toBeDefined();
    expect(installNodeStep?.with).toMatchObject({
      "node-version": "24.14.1"
    });
    expect(steps.some((step) => step.uses === "actions/setup-node@v6")).toBe(
      false
    );
    expect(forkSetupNodeStep?.with).toMatchObject({
      "node-version": "24",
      cache: "pnpm"
    });
  });

  test("verifies the broader shell-safe toolchain contract on self-hosted runners", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const contractJob = workflow.jobs.shell_safe_contract_trusted;
    const steps = contractJob.steps as Array<Record<string, unknown>>;
    const cacheStep = steps.find((step) => step.uses === "actions/cache@v4");
    const verifyToolchainStep = steps.find(
      (step) => step.name === "Verify built-in shell-safe toolchain"
    );
    const verifyCacheStep = steps.find(
      (step) => step.name === "Verify cache-aware commands"
    );

    expect(contractJob["runs-on"]).toEqual([
      "self-hosted",
      "synology",
      "shell-only",
      "public"
    ]);
    expect(contractJob.env).toMatchObject({
      RUNNER_TEMP: "/tmp/github-runner-temp",
      RUNNER_TOOL_CACHE: "/opt/hostedtoolcache",
      AGENT_TOOLSDIRECTORY: "/opt/hostedtoolcache",
      TF_PLUGIN_CACHE_DIR: "/tmp/github-runner-temp/terraform-plugin-cache"
    });
    expect(cacheStep?.with).toMatchObject({
      key: "${{ runner.os }}-shell-safe-contract-${{ hashFiles('docker/Dockerfile', '.github/workflows/ci.yml') }}"
    });
    expect(String(cacheStep?.with?.path)).toContain(".tmp/ci-shell-safe/npm");
    expect(String(cacheStep?.with?.path)).toContain(".tmp/ci-shell-safe/pip");
    expect(String(cacheStep?.with?.path)).toContain(
      "${{ env.TF_PLUGIN_CACHE_DIR }}"
    );
    expect(String(verifyToolchainStep?.run)).toContain("node --version");
    expect(String(verifyToolchainStep?.run)).toContain("python3.12 --version");
    expect(String(verifyToolchainStep?.run)).toContain("terraform version");
    expect(String(verifyCacheStep?.run)).toContain("python3.12 -m venv .venv-contract");
    expect(String(verifyCacheStep?.run)).toContain("npm config get cache");
    expect(String(verifyCacheStep?.run)).toContain(
      "terraform -chdir=.tmp/ci-shell-safe/terraform init -backend=false"
    );
  });

  test("keeps fork pull requests on GitHub-hosted runners", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    expect(workflow.jobs.test_public_fork_pr["runs-on"]).toBe("ubuntu-latest");
  });

  test("emits a CI Gate status that accepts success or skipped upstream jobs", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const gateJob = workflow.jobs.ci_gate;
    const steps = gateJob.steps as Array<Record<string, unknown>>;
    const checkStep = steps.find((step) => step.name === "Check required CI jobs");

    expect(gateJob.name).toBe("CI Gate");
    expect(gateJob.if).toBe("always()");
    expect(gateJob.needs).toEqual([
      "test_self_hosted_trusted",
      "shell_safe_contract_trusted",
      "test_public_fork_pr"
    ]);
    expect(gateJob["runs-on"]).toBe("ubuntu-latest");
    expect(String(checkStep?.env?.RESULTS)).toContain(
      "test_self_hosted_trusted=${{ needs.test_self_hosted_trusted.result }}"
    );
    expect(String(checkStep?.env?.RESULTS)).toContain(
      "shell_safe_contract_trusted=${{ needs.shell_safe_contract_trusted.result }}"
    );
    expect(String(checkStep?.env?.RESULTS)).toContain(
      "test_public_fork_pr=${{ needs.test_public_fork_pr.result }}"
    );
    expect(String(checkStep?.run)).toContain('$status" == "success" || "$status" == "skipped"');
  });
});
