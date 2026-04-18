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
    const enablePnpmStep = steps.find(
      (step) => step.name === "Enable pnpm from shell-safe Node"
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
    expect(steps.some((step) => step.uses === "pnpm/action-setup@v6")).toBe(
      false
    );
    expect(String(enablePnpmStep?.run)).toContain(
      "corepack prepare pnpm@10.32.1 --activate"
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
    const cacheStep = steps.find((step) => step.uses === "actions/cache@v5");
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

  test("renders the Linux Docker contract on hosted Linux before operators provision the pool", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const dockerJob = workflow.jobs.linux_docker_contract_trusted;
    const steps = dockerJob.steps as Array<Record<string, unknown>>;
    const renderStep = steps.find(
      (step) => step.name === "Render Linux Docker runner manifests"
    );

    expect(dockerJob["runs-on"]).toBe("ubuntu-latest");
    expect(String(renderStep?.run)).toContain("pnpm validate-linux-docker-config");
    expect(String(renderStep?.run)).toContain("pnpm render-linux-docker-compose");
    expect(String(renderStep?.run)).toContain(
      "pnpm render-linux-docker-project-manifest"
    );
  });

  test("keeps the Lume macOS pool contract on hosted macOS runners", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const lumeJob = workflow.jobs.lume_macos_contract_trusted;
    const steps = lumeJob.steps as Array<Record<string, unknown>>;
    const renderStep = steps.find(
      (step) => step.name === "Render Lume runner manifest"
    );
    const syntaxStep = steps.find(
      (step) => step.name === "Validate Lume shell scripts"
    );

    expect(lumeJob["runs-on"]).toBe("macos-latest");
    expect(String(renderStep?.run)).toContain("pnpm validate-lume-config");
    expect(String(renderStep?.run)).toContain("pnpm render-lume-runner-manifest");
    expect(String(syntaxStep?.run)).toContain("bash -n scripts/guest/macos-runner-bootstrap.sh");
    expect(String(syntaxStep?.run)).toContain("bash -n scripts/lume/reconcile-pool.sh");
  });
});
