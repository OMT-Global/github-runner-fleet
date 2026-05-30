import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadLinuxDockerConfig } from "../src/lib/linux-docker-config.js";
import type { DeploymentEnv } from "../src/lib/env.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadLinuxDockerConfig", () => {
  test("resolves environment placeholders and injects docker-capable labels", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "linux-docker-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-private
    organization: example
    runnerGroup: linux-docker-private
    repositoryAccess: selected
    allowedRepositories:
      - example/private-app
    labels:
      - x64
    size: 1
    architecture: amd64
    runnerRoot: \${LINUX_DOCKER_RUNNER_BASE_DIR}/pools/linux-docker-private
`,
      "utf8"
    );

    const config = loadLinuxDockerConfig(configPath, deploymentEnv());
    expect(config.pools[0].runnerRoot).toBe(
      "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private"
    );
    expect(config.pools[0].labels).toEqual([
      "linux",
      "shell-only",
      "synology",
      "docker-capable",
      "private",
      "x64"
    ]);
    expect(config.pools[0].visibility).toBe("private");
  });

  test("supports public Linux Docker pools for public shell-safe jobs", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "linux-docker-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-public
    visibility: public
    organization: example
    runnerGroup: linux-docker-public
    repositoryAccess: selected
    allowedRepositories:
      - example/public-app
    labels:
      - x64
    size: 1
    architecture: amd64
    runnerRoot: \${LINUX_DOCKER_RUNNER_BASE_DIR}/pools/linux-docker-public
`,
      "utf8"
    );

    const config = loadLinuxDockerConfig(configPath, deploymentEnv());

    expect(config.pools[0]).toMatchObject({
      key: "linux-docker-public",
      visibility: "public",
      labels: ["linux", "shell-only", "synology", "docker-capable", "public", "x64"],
      runnerRoot: "/srv/github-runner-fleet/linux-docker/pools/linux-docker-public"
    });
  });

  test("rejects repositories outside the configured organization", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "linux-docker-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-private
    organization: example
    runnerGroup: linux-docker-private
    repositoryAccess: selected
    allowedRepositories:
      - another-org/private-app
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: /srv/github-runner-fleet/linux-docker/pools/linux-docker-private
`,
      "utf8"
    );

    expect(() => loadLinuxDockerConfig(configPath, deploymentEnv())).toThrow(
      /outside organization example/
    );
  });

  test("rejects repositoryAccess all unless break-glass is explicit", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "linux-docker-runners.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-private
    organization: example
    runnerGroup: linux-docker-private
    repositoryAccess: all
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: /srv/github-runner-fleet/linux-docker/pools/linux-docker-private
`,
      "utf8"
    );

    expect(() => loadLinuxDockerConfig(configPath, deploymentEnv())).toThrow(
      /LINUX_DOCKER_ALLOW_ALL_REPOSITORIES=true/
    );
    expect(
      loadLinuxDockerConfig(
        configPath,
        deploymentEnv({
          LINUX_DOCKER_ALLOW_ALL_REPOSITORIES: "true"
        })
      ).pools[0].repositoryAccess
    ).toBe("all");
  });
});

function deploymentEnv(raw: Record<string, string> = {}): DeploymentEnv {
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
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
    composeProjectName: "github-runner-fleet",
    runnerVersion: "2.333.0",
    raw: {
      LINUX_DOCKER_RUNNER_BASE_DIR: "/srv/github-runner-fleet/linux-docker",
      ...raw
    }
  };
}

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linux-docker-config-"));
  tempPaths.push(directory);
  return directory;
}
