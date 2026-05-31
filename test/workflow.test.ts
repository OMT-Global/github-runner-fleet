import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

const shellSafePublicRunner = ["self-hosted", "linux", "shell-only", "public"];

describe("CI workflow", () => {
  test("runs mutation testing in extended validation and uploads the report", () => {
    const workflow = YAML.parse(
      fs.readFileSync(
        path.resolve(".github/workflows/extended-validation.yml"),
        "utf8"
      )
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const mutationJob = workflow.jobs["mutation-tests"];
    const gateJob = workflow.jobs["extended-validation-gate"];
    const steps = mutationJob.steps as Array<Record<string, unknown>>;
    const setupNodeStep = steps.find(
      (step) => step.uses === "./actions/setup-shell-safe-node"
    );
    const mutationStep = steps.find(
      (step) => step.name === "Run mutation tests"
    );
    const artifactStep = steps.find(
      (step) => step.uses === "actions/upload-artifact@v7"
    );

    expect(mutationJob["runs-on"]).toEqual([
      "self-hosted",
      "synology",
      "shell-only",
      "public"
    ]);
    expect(setupNodeStep?.with).toMatchObject({
      "node-version": "24.14.1"
    });
    expect(String(mutationStep?.run)).toContain("pnpm mutation-test");
    expect(artifactStep).toMatchObject({
      if: "always()",
      with: {
        name: "mutation-report",
        path: "reports/mutation/**",
        "if-no-files-found": "ignore"
      }
    });
    expect(gateJob.needs).toContain("mutation-tests");
  });

  test("runs drift detection only for scheduled or manual extended validation", () => {
    const workflow = YAML.parse(
      fs.readFileSync(
        path.resolve(".github/workflows/extended-validation.yml"),
        "utf8"
      )
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const driftJob = workflow.jobs["drift-detect"];
    const gateJob = workflow.jobs["extended-validation-gate"];
    const steps = driftJob.steps as Array<Record<string, unknown>>;
    const setupNodeStep = steps.find(
      (step) => step.uses === "./actions/setup-shell-safe-node"
    );
    const detectStep = steps.find(
      (step) => step.name === "Compare desired and actual runner pool state"
    );

    expect(driftJob["runs-on"]).toEqual([
      "self-hosted",
      "synology",
      "shell-only",
      "public"
    ]);
    expect(driftJob.if).toBe(
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'"
    );
    expect(setupNodeStep?.with).toMatchObject({
      "node-version": "24.14.1"
    });
    expect(detectStep?.env).toMatchObject({
      GITHUB_PAT: "${{ secrets.RUNNER_FLEET_GITHUB_PAT }}",
      DRIFT_THRESHOLD: "${{ vars.DRIFT_THRESHOLD }}",
      DRIFT_NOTIFY_CHANNEL: "${{ vars.DRIFT_NOTIFY_CHANNEL }}"
    });
    expect(String(detectStep?.run)).toContain("pnpm drift-detect");
    expect(String(detectStep?.run)).toContain(
      '--threshold "${DRIFT_THRESHOLD:-0}"'
    );
    expect(gateJob.needs).toContain("drift-detect");
  });

  test("keeps required trusted CI on shell-safe self-hosted runners", () => {
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
    const pnpmStep = steps.find((step) => step.uses === "pnpm/action-setup@v6");
    const forkSteps = workflow.jobs.test_public_fork_pr.steps as Array<
      Record<string, unknown>
    >;
    const forkSetupNodeStep = forkSteps.find(
      (step) => step.uses === "actions/setup-node@v6"
    );

    expect(trustedJob["runs-on"]).toEqual(shellSafePublicRunner);
    expect(pnpmStep?.with).toMatchObject({
      version: "10.32.1"
    });
    expect(setupNodeStep?.with).toMatchObject({
      "node-version": "24"
    });
    expect(forkSetupNodeStep?.with).toMatchObject({
      "node-version": "24"
    });
    expect(steps.indexOf(setupNodeStep ?? {})).toBeLessThan(
      steps.indexOf(pnpmStep ?? {})
    );
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

    expect(contractJob.if).toContain(
      "vars.SHELL_SAFE_CONTRACT_ENABLED == 'true'"
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

  test("keeps PR fast checks on self-hosted runners and gates same-repo and fork paths", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/pr-fast-ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const selfHostedJobs = [
      workflow.jobs["fast-checks"],
      workflow.jobs["validate-secrets"]
    ];
    for (const job of selfHostedJobs) {
      expect(job["runs-on"]).toEqual(shellSafePublicRunner);
      expect(String(job.if)).toContain(
        "github.event.pull_request.head.repo.full_name == github.repository"
      );
    }
    expect(
      (workflow.jobs["fast-checks"].steps as Array<Record<string, unknown>>).some(
        (step) => step.uses === "actions/setup-node@v6"
      )
    ).toBe(true);

    expect(workflow.jobs.changes["runs-on"]).toEqual(shellSafePublicRunner);
    expect(workflow.jobs["hosted-fork-fast-checks"]["runs-on"]).toBe(
      "ubuntu-latest"
    );
    expect(String(workflow.jobs["hosted-fork-fast-checks"].if)).toContain(
      "github.event.pull_request.head.repo.full_name != github.repository"
    );
    expect(workflow.jobs["hosted-fork-validate-secrets"]["runs-on"]).toBe(
      "ubuntu-latest"
    );
    expect(String(workflow.jobs["hosted-fork-validate-secrets"].if)).toContain(
      "github.event.pull_request.head.repo.full_name != github.repository"
    );
    expect(workflow.jobs["ci-gate"].needs).toEqual(
      expect.arrayContaining([
        "fast-checks",
        "validate-secrets",
        "hosted-fork-fast-checks",
        "hosted-fork-validate-secrets"
      ])
    );
    expect(workflow.jobs["ci-gate"]["runs-on"]).toEqual(shellSafePublicRunner);
  });

  test("renders the Linux Docker contract on shell-safe self-hosted Linux", () => {
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

    expect(dockerJob["runs-on"]).toEqual(shellSafePublicRunner);
    expect(String(renderStep?.run)).toContain("pnpm validate-linux-docker-config");
    expect(String(renderStep?.run)).toContain("pnpm render-linux-docker-compose");
    expect(String(renderStep?.run)).toContain(
      "pnpm render-linux-docker-project-manifest"
    );
  });

  test("keeps the Windows Docker contract opt-in for self-hosted Windows runners", () => {
    const workflow = YAML.parse(
      fs.readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8")
    ) as {
      jobs: Record<string, Record<string, unknown>>;
    };

    const windowsJob = workflow.jobs.windows_contract_trusted;
    const steps = windowsJob.steps as Array<Record<string, unknown>>;
    const renderStep = steps.find(
      (step) => step.name === "Render Windows Docker runner manifests"
    );
    const syntaxStep = steps.find(
      (step) => step.name === "Validate Windows entrypoint syntax"
    );

    expect(windowsJob.if).toContain(
      "vars.WINDOWS_DOCKER_CONTRACT_ENABLED == 'true'"
    );
    expect(windowsJob["runs-on"]).toEqual([
      "self-hosted",
      "windows",
      "docker-capable",
      "private"
    ]);
    expect(String(renderStep?.run)).toContain("pnpm validate-windows-config");
    expect(String(renderStep?.run)).toContain("pnpm render-windows-compose");
    expect(String(renderStep?.run)).toContain(
      "pnpm render-windows-project-manifest"
    );
    expect(String(syntaxStep?.run)).toContain("docker/runner-entrypoint.ps1");
  });

  test("keeps the Lume macOS pool contract on GitHub-hosted runners", () => {
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
    const lifecycleStep = steps.find(
      (step) => step.name === "Exercise Lume project lifecycle"
    );
    const syntaxStep = steps.find(
      (step) => step.name === "Validate Lume shell scripts"
    );

    expect(lumeJob["runs-on"]).toBe("ubuntu-latest");
    expect(String(renderStep?.run)).toContain("pnpm validate-lume-config");
    expect(String(renderStep?.run)).toContain("pnpm render-lume-runner-manifest");
    expect(String(lifecycleStep?.run)).toContain("pnpm install-lume-project");
    expect(String(lifecycleStep?.run)).toContain("pnpm teardown-lume-project");
    expect(String(syntaxStep?.run)).toContain("bash -n scripts/guest/macos-runner-bootstrap.sh");
    expect(String(syntaxStep?.run)).toContain("bash -n scripts/lume/reconcile-pool.sh");
  });
});
