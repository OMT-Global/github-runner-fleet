import YAML from "yaml";
import { describe, expect, test } from "vitest";
import type { DeploymentEnv } from "../src/lib/env.js";
import { renderWindowsDockerCompose } from "../src/lib/windows-compose.js";
import type { ResolvedWindowsDockerConfig } from "../src/lib/windows-config.js";

describe("renderWindowsDockerCompose", () => {
  test("renders Windows runner services with named-pipe Docker access", () => {
    const compose = renderWindowsDockerCompose(configFixture(), envFixture());
    const payload = YAML.parse(compose.split("\n").slice(2).join("\n")) as {
      services: Record<string, Record<string, unknown>>;
    };

    const service = payload.services["windows-private-runner-01"];
    expect(service.environment).toMatchObject({
      RUNNER_GROUP: "windows-private",
      RUNNER_LABELS: "windows,docker-capable,private,x64",
      RUNNER_WORK_DIR:
        "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private\\runner-01\\_work",
      RUNNER_TEMP:
        "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private\\runner-01\\_temp",
      DOCKER_HOST: "npipe:////./pipe/docker_engine"
    });
    expect(service.volumes).toEqual([
      "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private\\runner-01:C:\\github-runner-fleet\\windows-docker\\pools\\windows-private\\runner-01",
      {
        type: "npipe",
        source: "\\\\.\\pipe\\docker_engine",
        target: "\\\\.\\pipe\\docker_engine"
      }
    ]);
    expect(service.labels).toMatchObject({
      "com.github-runner-fleet.plane": "windows-docker",
      "com.github-runner-fleet.docker-capable": "true"
    });
  });
});

function configFixture(): ResolvedWindowsDockerConfig {
  return {
    version: 1,
    plane: "windows-docker",
    pools: [
      {
        key: "windows-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "windows-private",
        repositoryAccess: "selected",
        allowedRepositories: ["example/windows-app"],
        labels: ["windows", "docker-capable", "private", "x64"],
        size: 1,
        host: "windows-host.example.com",
        sshUser: "administrator",
        sshPort: "22",
        runnerRoot:
          "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private",
        resources: {
          memory: "8g"
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9-windows"
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
    raw: {}
  };
}
