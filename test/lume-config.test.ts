import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadLumeConfig, renderLumeShellExports } from "../src/lib/lume-config.js";
import type { DeploymentEnv } from "../src/lib/env.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadLumeConfig", () => {
  test("injects default macOS runner labels and derives slot manifests", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "lume-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  labels:
    - custom
  size: 2
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const config = loadLumeConfig(configPath, deploymentEnv());

    expect(config.pool.labels).toEqual([
      "self-hosted",
      "macos",
      "arm64",
      "private",
      "custom"
    ]);
    expect(config.slots).toHaveLength(2);
    expect(config.slots[0]).toMatchObject({
      index: 1,
      slotKey: "slot-01",
      vmName: "macos-runner-slot-01",
      runnerName: "macos-runner-slot-01"
    });
    expect(config.host.envFile).toBe(
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env"
    );
    expect(config.host.ipswPath).toBe(
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/cache/latest.ipsw"
    );
    expect(config.host.reconcileStateFile).toBe(
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/reconcile-state.json"
    );
  });

  test("renders shell exports for a specific slot", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "lume-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
pool:
  key: macos-private
  size: 1
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const config = loadLumeConfig(configPath, deploymentEnv());
    const shellExports = renderLumeShellExports(config, 1);

    expect(shellExports).toContain("export LUME_VM_NAME='macos-runner-slot-01'");
    expect(shellExports).toContain("export RUNNER_NAME='macos-runner-slot-01'");
    expect(shellExports).toContain(
      "export LUME_HOST_IPSW_PATH='/Users/tester/Library/Application Support/github-runner-fleet/lume/cache/latest.ipsw'"
    );
    expect(shellExports).toContain(
      "export LUME_RECONCILE_STATE_FILE='/Users/tester/Library/Application Support/github-runner-fleet/lume/reconcile-state.json'"
    );
    expect(shellExports).toContain(
      "export RUNNER_LABELS='self-hosted,macos,arm64,private'"
    );
  });
});

function deploymentEnv(): DeploymentEnv {
  return {
    githubApiUrl: "https://api.github.com",
    githubPat: undefined,
    synologyRunnerBaseDir: "/volume1/docker/github-runner-fleet",
    synologyHost: "nas.example.com",
    synologyPort: "5001",
    synologyUsername: "admin",
    synologyPassword: "secret",
    synologySecure: true,
    synologyCertVerify: false,
    synologyDsmVersion: 7,
    synologyApiRepo: "/Users/tester/src/synology-api",
    synologyProjectDir: "/volume1/docker/github-runner-fleet",
    synologyProjectComposeFile: "compose.yaml",
    synologyProjectEnvFile: ".env",
    synologyInstallPullImages: true,
    synologyInstallForceRecreate: true,
    synologyInstallRemoveOrphans: true,
    linuxDockerRunnerBaseDir: "/srv/github-runner-fleet/linux-docker",
    linuxDockerHost: "docker-host.example.com",
    linuxDockerPort: "22",
    linuxDockerUsername: "runner",
    linuxDockerProjectDir: "/srv/github-runner-fleet/linux-docker",
    linuxDockerProjectComposeFile: "compose.yaml",
    linuxDockerProjectEnvFile: ".env",
    linuxDockerInstallPullImages: true,
    linuxDockerInstallForceRecreate: true,
    linuxDockerInstallRemoveOrphans: true,
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
    lumeRunnerIpswPath:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/cache/latest.ipsw",
    composeProjectName: "github-runner-fleet",
    runnerVersion: "2.333.0",
    raw: {
      GITHUB_API_URL: "https://api.github.com",
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/github-runner-fleet",
      LINUX_DOCKER_RUNNER_BASE_DIR: "/srv/github-runner-fleet/linux-docker",
      LUME_RUNNER_BASE_DIR:
        "/Users/tester/Library/Application Support/github-runner-fleet/lume",
      LUME_RUNNER_ENV_FILE:
        "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
      LUME_RUNNER_IPSW_PATH:
        "/Users/tester/Library/Application Support/github-runner-fleet/lume/cache/latest.ipsw",
      COMPOSE_PROJECT_NAME: "github-runner-fleet",
      RUNNER_VERSION: "2.333.0"
    }
  };
}

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-config-"));
  tempPaths.push(directory);
  return directory;
}
