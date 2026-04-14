import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { collectConfigWarnings, loadConfig } from "../src/lib/config.js";
import type { DeploymentEnv } from "../src/lib/env.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  test("resolves environment placeholders and injects required labels", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: all
    labels:
      - shell-only
      - custom-label
    size: 1
    architecture: arm64
    runnerRoot: \${SYNOLOGY_RUNNER_BASE_DIR}/pools/synology-private
`,
      "utf8"
    );

    const config = loadConfig(configPath, deploymentEnv());
    expect(config.pools[0].runnerRoot).toBe(
      "/volume1/docker/github-runner-fleet/pools/synology-private"
    );
    expect(config.pools[0].labels).toEqual([
      "synology",
      "shell-only",
      "private",
      "custom-label"
    ]);
    expect(config.pools[0].repositoryAccess).toBe("all");
    expect(config.pools[0].allowedRepositories).toEqual([]);
  });

  test("rejects repositories outside the configured organization", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-public
    visibility: public
    organization: example
    runnerGroup: synology-public
    repositoryAccess: selected
    allowedRepositories:
      - another-org/public-demo
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-public
`,
      "utf8"
    );

    expect(() => loadConfig(configPath, deploymentEnv())).toThrow(
      /outside organization example/
    );
  });

  test("rejects duplicate pool keys", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: selected
    allowedRepositories:
      - example/private-app
    labels: []
    size: 1
    architecture: arm64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-private
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: selected
    allowedRepositories:
      - example/other-app
    labels: []
    size: 1
    architecture: arm64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-private-2
`,
      "utf8"
    );

    expect(() => loadConfig(configPath, deploymentEnv())).toThrow(
      /duplicate pool key/
    );
  });

  test("requires selected repository lists when repositoryAccess is selected", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-public
    visibility: public
    organization: example
    runnerGroup: synology-public
    repositoryAccess: selected
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-public
`,
      "utf8"
    );

    expect(() => loadConfig(configPath, deploymentEnv())).toThrow(
      /allowedRepositories must contain at least one repository/
    );
  });

  test("rejects allowedRepositories when repositoryAccess is all", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: all
    allowedRepositories:
      - example/private-app
    labels: []
    size: 1
    architecture: arm64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-private
`,
      "utf8"
    );

    expect(() => loadConfig(configPath, deploymentEnv())).toThrow(
      /allowedRepositories must be omitted when repositoryAccess is all/
    );
  });

  test("warns when cpu limits are configured", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: all
    labels: []
    size: 1
    architecture: arm64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-private
    resources:
      cpus: "2.0"
      memory: 2g
      pidsLimit: 256
`,
      "utf8"
    );

    const config = loadConfig(configPath, deploymentEnv());

    expect(collectConfigWarnings(config)).toContainEqual(
      expect.stringMatching(
        /pool synology-private sets resources\.cpus=2\.0; Synology kernels often reject Docker NanoCPUs/
      )
    );
  });

  test("warns when pid limits are configured", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: all
    labels: []
    size: 1
    architecture: auto
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-private
    resources:
      memory: 2g
      pidsLimit: 256
`,
      "utf8"
    );

    const config = loadConfig(configPath, deploymentEnv());

    expect(collectConfigWarnings(config)).toContainEqual(
      expect.stringMatching(
        /pool synology-private sets resources\.pidsLimit=256; Synology kernels often reject Docker PID cgroup limits/
      )
    );
  });

  test("does not warn when cpu limits are omitted", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.5
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: all
    labels: []
    size: 1
    architecture: arm64
    runnerRoot: /volume1/docker/github-runner-fleet/pools/synology-private
`,
      "utf8"
    );

    const config = loadConfig(configPath, deploymentEnv());

    expect(collectConfigWarnings(config)).toEqual([]);
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
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/github-runner-fleet/lume/runner.env",
    composeProjectName: "github-runner-fleet",
    runnerVersion: "2.327.1",
    raw: {
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/github-runner-fleet",
      LINUX_DOCKER_RUNNER_BASE_DIR: "/srv/github-runner-fleet/linux-docker"
    }
  };
}

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synology-gh-runner-"));
  tempPaths.push(directory);
  return directory;
}
