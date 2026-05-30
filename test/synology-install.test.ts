import { describe, expect, test } from "vitest";
import { renderCompose } from "../src/lib/compose.js";
import type { ResolvedConfig } from "../src/lib/config.js";
import type { DeploymentEnv } from "../src/lib/env.js";
import {
  buildSynologyInstallPlan,
  summarizeSynologyInstallPlan
} from "../src/lib/synology-install.js";

describe("buildSynologyInstallPlan", () => {
  test("renders remote project files and deployment script", () => {
    const env = envFixture();
    const compose = renderCompose(configFixture(), env);
    const plan = buildSynologyInstallPlan(configFixture(), env, compose);

    expect(plan.project).toMatchObject({
      name: "github-runner-fleet",
      directory: "/volume1/docker/github-runner-fleet",
      composeFileName: "compose.yaml",
      envFileName: ".env",
      logFileName: "install-project.log"
    });
    expect(plan.envFileContent).toContain('GITHUB_PAT="test-pat"');
    expect(plan.envFileContent).toContain(
      'GITHUB_API_URL="https://api.github.com"'
    );
    expect(plan.deploymentScript).toContain(
      '"$docker_bin" compose -p "$project_name" -f "$compose_file" pull'
    );
    expect(plan.stateDirectories).toEqual([
      "/volume1/docker/github-runner-fleet/pools/synology-private/runner-01"
    ]);
    expect(plan.deploymentScript).toContain(
      "mkdir -p '/volume1/docker/github-runner-fleet' '/volume1/docker/github-runner-fleet/logs' '/volume1/docker/github-runner-fleet/pools/synology-private/runner-01'"
    );
    expect(plan.deploymentScript).toContain("--force-recreate");
    expect(plan.deploymentScript).toContain("--remove-orphans");
  });

  test("redacts secrets in the summary output", () => {
    const env = envFixture();
    const plan = buildSynologyInstallPlan(
      configFixture(),
      env,
      renderCompose(configFixture(), env)
    );
    const summary = summarizeSynologyInstallPlan(plan);

    expect(summary.connection.passwordConfigured).toBe(true);
    expect(summary).not.toHaveProperty("password");
    expect(summary.envFilePreview).toContain("GITHUB_PAT=<redacted>");
  });

  test("renders teardown script with compose down", () => {
    const env = envFixture();
    const plan = buildSynologyInstallPlan(
      configFixture(),
      env,
      renderCompose(configFixture(), env),
      {
        action: "down"
      }
    );

    expect(plan.options.action).toBe("down");
    expect(plan.deploymentScript).toContain(
      '"$docker_bin" compose -p "$project_name" -f "$compose_file" down --remove-orphans'
    );
    expect(plan.deploymentScript).not.toContain(
      '"$docker_bin" compose -p "$project_name" -f "$compose_file" pull'
    );
    expect(plan.deploymentScript).not.toContain("up -d");
  });
});

function configFixture(): ResolvedConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/github-runner-fleet",
      tag: "0.1.9"
    },
    pools: [
      {
        key: "synology-private",
        visibility: "private",
        organization: "example",
        runnerGroup: "synology-private",
        repositoryAccess: "all",
        allowedRepositories: [],
        labels: ["linux", "shell-only", "private", "synology"],
        size: 1,
        architecture: "auto",
        runnerRoot: "/volume1/docker/github-runner-fleet/pools/synology-private",
        resources: {
          memory: "2g"
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
