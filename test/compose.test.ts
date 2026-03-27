import YAML from "yaml";
import { describe, expect, test } from "vitest";
import { renderCompose } from "../src/lib/compose.js";
import type { ResolvedConfig } from "../src/lib/config.js";
import type { DeploymentEnv } from "../src/lib/env.js";

describe("renderCompose", () => {
  test("renders one service per runner slot with shell-only isolation", () => {
    const compose = renderCompose(configFixture(), envFixture());
    const payload = YAML.parse(compose.split("\n").slice(2).join("\n")) as {
      services: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(payload.services)).toEqual([
      "synology-private-runner-01",
      "synology-private-runner-02",
      "synology-public-runner-01"
    ]);

    const privateService = payload.services["synology-private-runner-01"];
    expect(privateService.environment).toMatchObject({
      RUNNER_GROUP: "synology-private",
      RUNNER_LABELS: "synology,shell-only,private",
      RUNNER_SCOPE: "organization"
    });
    expect(privateService.volumes).toEqual([
      "/volume1/docker/synology-github-runner/pools/synology-private/runner-01:/volume1/docker/synology-github-runner/pools/synology-private/runner-01"
    ]);
    expect(JSON.stringify(privateService)).not.toContain("/var/run/docker.sock");
  });
});

function configFixture(): ResolvedConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/synology-github-runner",
      tag: "0.1.0"
    },
    pools: [
      {
        key: "synology-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "synology-private",
        allowedRepositories: ["example/private-app"],
        labels: ["synology", "shell-only", "private"],
        size: 2,
        architecture: "arm64",
        runnerRoot: "/volume1/docker/synology-github-runner/pools/synology-private",
        resources: {
          cpus: "2.0",
          memory: "2g",
          pidsLimit: 256
        },
        imageRef: "ghcr.io/example/synology-github-runner:0.1.0"
      },
      {
        key: "synology-public",
        visibility: "public",
        organization: "example",
        runnerGroup: "synology-public",
        allowedRepositories: ["example/public-demo"],
        labels: ["synology", "shell-only", "public"],
        size: 1,
        architecture: "arm64",
        runnerRoot: "/volume1/docker/synology-github-runner/pools/synology-public",
        resources: {
          cpus: "1.0",
          memory: "1g",
          pidsLimit: 192
        },
        imageRef: "ghcr.io/example/synology-github-runner:0.1.0"
      }
    ]
  };
}

function envFixture(): DeploymentEnv {
  return {
    githubApiUrl: "https://api.github.com",
    synologyRunnerBaseDir: "/volume1/docker/synology-github-runner",
    composeProjectName: "synology-github-runner",
    runnerVersion: "2.327.1",
    raw: {}
  };
}
