import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DeploymentEnv } from "../src/lib/env.js";
import { loadWindowsDockerConfig } from "../src/lib/windows-config.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadWindowsDockerConfig", () => {
  test("supports issue-style pool aliases and injects Windows labels", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "windows-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
plane: windows-docker
pools:
  - name: windows-private
    group: windows-private
    repositoryAccess: selected
    repositories:
      - example/windows-app
    slots: 2
    host: windows-host.example.com
    sshUser: administrator
    image: ghcr.io/example/github-runner-fleet:0.1.9-windows
    runnerRoot: \${WINDOWS_DOCKER_RUNNER_BASE_DIR}\\pools\\windows-private
    labels:
      - x64
`,
      "utf8"
    );

    const config = loadWindowsDockerConfig(configPath, deploymentEnv());
    expect(config.plane).toBe("windows-docker");
    expect(config.pools[0]).toEqual(
      expect.objectContaining({
        key: "windows-private",
        organization: "example",
        runnerGroup: "windows-private",
        size: 2,
        host: "windows-host.example.com",
        sshUser: "administrator",
        runnerRoot:
          "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private",
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9-windows",
        labels: ["windows", "docker-capable", "private", "x64"]
      })
    );
  });

  test("rejects repositories outside the configured organization", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "windows-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
plane: windows-docker
pools:
  - key: windows-private
    organization: example
    runnerGroup: windows-private
    repositoryAccess: selected
    allowedRepositories:
      - another-org/windows-app
    host: windows-host.example.com
    sshUser: administrator
    image: ghcr.io/example/github-runner-fleet:0.1.9-windows
`,
      "utf8"
    );

    expect(() => loadWindowsDockerConfig(configPath, deploymentEnv())).toThrow(
      /outside organization example/
    );
  });

  test("requires one remote host per config", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "windows-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
plane: windows-docker
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9-windows
pools:
  - key: windows-one
    organization: example
    runnerGroup: windows-one
    repositoryAccess: all
    host: windows-one.example.com
    sshUser: administrator
  - key: windows-two
    organization: example
    runnerGroup: windows-two
    repositoryAccess: all
    host: windows-two.example.com
    sshUser: administrator
`,
      "utf8"
    );

    expect(() => loadWindowsDockerConfig(configPath, deploymentEnv())).toThrow(
      /must target the same host/
    );
  });
});

function deploymentEnv(): DeploymentEnv {
  return {
    githubApiUrl: "https://api.github.com",
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
    windowsDockerRunnerBaseDir: "C:\\github-runner-fleet\\windows-docker",
    windowsDockerHost: "windows-host.example.com",
    windowsDockerPort: "22",
    windowsDockerUsername: "administrator",
    windowsDockerProjectDir: "C:\\github-runner-fleet\\windows-docker",
    windowsDockerProjectComposeFile: "compose.yaml",
    windowsDockerProjectEnvFile: ".env",
    windowsDockerInstallPullImages: true,
    windowsDockerInstallForceRecreate: true,
    windowsDockerInstallRemoveOrphans: true,
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
    composeProjectName: "github-runner-fleet",
    runnerVersion: "2.333.0",
    raw: {
      WINDOWS_DOCKER_RUNNER_BASE_DIR: "C:\\github-runner-fleet\\windows-docker"
    }
  };
}

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "windows-config-"));
  tempPaths.push(directory);
  return directory;
}
