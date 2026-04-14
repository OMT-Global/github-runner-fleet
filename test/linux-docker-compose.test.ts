import YAML from "yaml";
import { describe, expect, test } from "vitest";
import { renderLinuxDockerCompose } from "../src/lib/linux-docker-compose.js";
import type { DeploymentEnv } from "../src/lib/env.js";
import type { ResolvedLinuxDockerConfig } from "../src/lib/linux-docker-config.js";

describe("renderLinuxDockerCompose", () => {
  test("renders Docker-capable runner services with host-visible state paths", () => {
    const compose = renderLinuxDockerCompose(configFixture(), envFixture());
    const payload = YAML.parse(compose.split("\n").slice(2).join("\n")) as {
      services: Record<string, Record<string, unknown>>;
    };

    const service = payload.services["linux-docker-private-runner-01"];
    expect(service.environment).toMatchObject({
      RUNNER_GROUP: "linux-docker-private",
      RUNNER_LABELS: "linux,docker-capable,private,x64",
      RUNNER_WORK_DIR:
        "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private/runner-01/_work",
      RUNNER_TEMP:
        "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private/runner-01/_temp",
      RUNNER_EXEC_MODE_OVERRIDE: "root",
      DOCKER_HOST: "unix:///var/run/docker.sock"
    });
    expect(service.volumes).toEqual([
      "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private/runner-01:/srv/github-runner-fleet/linux-docker/pools/linux-docker-private/runner-01",
      "/var/run/docker.sock:/var/run/docker.sock"
    ]);
    expect(service.labels).toMatchObject({
      "com.github-runner-fleet.plane": "linux-docker",
      "com.github-runner-fleet.docker-capable": "true"
    });
  });
});

function configFixture(): ResolvedLinuxDockerConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/github-runner-fleet",
      tag: "0.1.9"
    },
    pools: [
      {
        key: "linux-docker-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "linux-docker-private",
        repositoryAccess: "selected",
        allowedRepositories: ["example/private-app"],
        labels: ["linux", "docker-capable", "private", "x64"],
        size: 1,
        architecture: "amd64",
        runnerRoot: "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private",
        resources: {
          cpus: "4",
          memory: "8g"
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9"
      }
    ]
  };
}

function envFixture(): DeploymentEnv {
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
    raw: {}
  };
}
