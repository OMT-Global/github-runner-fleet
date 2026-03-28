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
      "synology-public-runner-01",
      "synology-public-runner-02"
    ]);

    const privateService = payload.services["synology-private-runner-01"];
    expect(privateService.environment).toMatchObject({
      RUNNER_GROUP: "synology-private",
      RUNNER_LABELS: "synology,shell-only,private",
      RUNNER_SCOPE: "organization",
      RUNNER_REPOSITORY_ACCESS: "all",
      RUNNER_WORK_DIR: "/tmp/github-runner-work",
      RUNNER_TEMP: "/tmp/github-runner-temp",
      RUNNER_TOOL_CACHE: "/opt/hostedtoolcache",
      AGENT_TOOLSDIRECTORY: "/opt/hostedtoolcache"
    });
    expect(privateService.environment).not.toHaveProperty(
      "RUNNER_ALLOWED_REPOSITORIES"
    );
    expect(privateService.volumes).toEqual([
      "/volume1/docker/synology-github-runner/pools/synology-private/runner-01:/volume1/docker/synology-github-runner/pools/synology-private/runner-01"
    ]);
    expect(privateService.security_opt).toEqual(["no-new-privileges:true"]);
    expect(privateService.cap_drop).toEqual(["ALL"]);
    expect(privateService.cap_add).toEqual(["CHOWN"]);
    expect(privateService).not.toHaveProperty("init");
    expect(privateService).not.toHaveProperty("platform");
    expect(privateService).not.toHaveProperty("cpus");
    expect(privateService).not.toHaveProperty("pids_limit");
    expect(JSON.stringify(privateService)).not.toContain("/var/run/docker.sock");

    const publicService = payload.services["synology-public-runner-01"];
    expect(publicService.environment).toMatchObject({
      RUNNER_REPOSITORY_ACCESS: "selected",
      RUNNER_ALLOWED_REPOSITORIES: "example/public-demo"
    });
    expect(publicService).not.toHaveProperty("init");
    expect(publicService).not.toHaveProperty("platform");
    expect(publicService).not.toHaveProperty("cpus");
    expect(publicService).not.toHaveProperty("pids_limit");
  });
});

function configFixture(): ResolvedConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/synology-github-runner",
      tag: "0.1.5"
    },
    pools: [
      {
        key: "synology-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "synology-private",
        repositoryAccess: "all",
        allowedRepositories: [],
        labels: ["synology", "shell-only", "private"],
        size: 2,
        architecture: "auto",
        runnerRoot: "/volume1/docker/synology-github-runner/pools/synology-private",
        resources: {
          memory: "2g"
        },
        imageRef: "ghcr.io/example/synology-github-runner:0.1.5"
      },
      {
        key: "synology-public",
        visibility: "public",
        organization: "example",
        runnerGroup: "synology-public",
        repositoryAccess: "selected",
        allowedRepositories: ["example/public-demo"],
        labels: ["synology", "shell-only", "public"],
        size: 2,
        architecture: "auto",
        runnerRoot: "/volume1/docker/synology-github-runner/pools/synology-public",
        resources: {
          memory: "1g"
        },
        imageRef: "ghcr.io/example/synology-github-runner:0.1.5"
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
