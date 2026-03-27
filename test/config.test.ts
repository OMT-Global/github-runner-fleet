import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../src/lib/config.js";
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
  repository: ghcr.io/example/synology-github-runner
  tag: 0.1.0
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    allowedRepositories:
      - example/private-app
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
      "/volume1/docker/synology-github-runner/pools/synology-private"
    );
    expect(config.pools[0].labels).toEqual([
      "synology",
      "shell-only",
      "private",
      "custom-label"
    ]);
  });

  test("rejects repositories outside the configured organization", () => {
    const directory = createTempDir();
    const configPath = path.join(directory, "pools.yaml");

    fs.writeFileSync(
      configPath,
      `version: 1
image:
  repository: ghcr.io/example/synology-github-runner
  tag: 0.1.0
pools:
  - key: synology-public
    visibility: public
    organization: example
    runnerGroup: synology-public
    allowedRepositories:
      - another-org/public-demo
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: /volume1/docker/synology-github-runner/pools/synology-public
`,
      "utf8"
    );

    expect(() => loadConfig(configPath, deploymentEnv())).toThrow(
      /outside organization example/
    );
  });
});

function deploymentEnv(): DeploymentEnv {
  return {
    githubApiUrl: "https://api.github.com",
    synologyRunnerBaseDir: "/volume1/docker/synology-github-runner",
    composeProjectName: "synology-github-runner",
    runnerVersion: "2.327.1",
    raw: {
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/synology-github-runner"
    }
  };
}

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synology-gh-runner-"));
  tempPaths.push(directory);
  return directory;
}
