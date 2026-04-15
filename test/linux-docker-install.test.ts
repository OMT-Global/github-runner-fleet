import { describe, expect, test } from "vitest";
import type { DeploymentEnv } from "../src/lib/env.js";
import type { ResolvedLinuxDockerConfig } from "../src/lib/linux-docker-config.js";
import { renderLinuxDockerCompose } from "../src/lib/linux-docker-compose.js";
import {
  buildLinuxDockerInstallPlan,
  summarizeLinuxDockerInstallPlan
} from "../src/lib/linux-docker-install.js";

describe("buildLinuxDockerInstallPlan", () => {
  test("renders remote project files and deployment script", () => {
    const env = envFixture();
    const compose = renderLinuxDockerCompose(configFixture(), env);
    const plan = buildLinuxDockerInstallPlan(configFixture(), env, compose);

    expect(plan.project).toMatchObject({
      name: "github-runner-fleet-linux-docker",
      directory: "/srv/github-runner-fleet/linux-docker",
      composeFileName: "compose.yaml",
      envFileName: ".env",
      deploymentScriptName: "deploy-linux-docker.sh"
    });
    expect(plan.envFileContent).toContain('GITHUB_PAT="test-pat"');
    expect(plan.deploymentScript).toContain(
      '"$docker_bin" compose -p "$project_name" -f "$compose_file" pull'
    );
    expect(plan.stateDirectories).toEqual([
      "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private/runner-01"
    ]);
  });

  test("redacts secrets in the summary output", () => {
    const env = envFixture();
    const plan = buildLinuxDockerInstallPlan(
      configFixture(),
      env,
      renderLinuxDockerCompose(configFixture(), env)
    );
    const summary = summarizeLinuxDockerInstallPlan(plan);

    expect(summary.envFilePreview).toContain("GITHUB_PAT=<redacted>");
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
        repositoryAccess: "all",
        allowedRepositories: [],
        labels: ["linux", "docker-capable", "private", "x64"],
        size: 1,
        architecture: "amd64",
        runnerRoot: "/srv/github-runner-fleet/linux-docker/pools/linux-docker-private",
        resources: {
          memory: "8g"
        },
        imageRef: "ghcr.io/example/github-runner-fleet:0.1.9"
      }
    ]
  };
}

function envFixture(): DeploymentEnv {
  return {
    githubPat: "test-pat",
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
