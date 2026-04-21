import { describe, expect, test } from "vitest";
import type { DeploymentEnv } from "../src/lib/env.js";
import { renderWindowsDockerCompose } from "../src/lib/windows-compose.js";
import type { ResolvedWindowsDockerConfig } from "../src/lib/windows-config.js";
import {
  buildWindowsDockerInstallPlan,
  renderWindowsDockerComposeEnvFile,
  summarizeWindowsDockerInstallPlan
} from "../src/lib/windows-install.js";

describe("buildWindowsDockerInstallPlan", () => {
  test("renders remote project files and PowerShell deployment script", () => {
    const env = envFixture();
    const compose = renderWindowsDockerCompose(configFixture(), env);
    const plan = buildWindowsDockerInstallPlan(configFixture(), env, compose);

    expect(plan.project).toMatchObject({
      name: "github-runner-fleet-windows-docker",
      directory: "C:\\github-runner-fleet\\windows-docker",
      composeFileName: "compose.yaml",
      envFileName: ".env",
      deploymentScriptName: "Deploy-WindowsDocker.ps1"
    });
    expect(plan.envFileContent).toContain('GITHUB_PAT="test-pat"');
    expect(plan.deploymentScript).toContain(
      "& $Docker compose -p $ProjectName -f $ComposeFile pull"
    );
    expect(plan.stateDirectories).toEqual([
      "C:\\github-runner-fleet\\windows-docker\\pools\\windows-private\\runner-01"
    ]);
  });

  test("redacts secrets in the summary output", () => {
    const env = envFixture();
    const plan = buildWindowsDockerInstallPlan(
      configFixture(),
      env,
      renderWindowsDockerCompose(configFixture(), env)
    );
    const summary = summarizeWindowsDockerInstallPlan(plan);

    expect(summary.envFilePreview).toContain("GITHUB_PAT=<redacted>");
  });

  test("rejects missing required connection and token values", () => {
    const env = {
      ...envFixture(),
      githubPat: undefined
    };
    const config = {
      ...configFixture(),
      pools: [
        {
          ...configFixture().pools[0],
          host: "",
          sshUser: ""
        }
      ]
    };

    expect(() =>
      buildWindowsDockerInstallPlan(
        config,
        env,
        renderWindowsDockerCompose(config, env)
      )
    ).toThrow(
      "missing required Windows Docker install env: WINDOWS_DOCKER_HOST, WINDOWS_DOCKER_USERNAME, GITHUB_PAT"
    );
  });

  test("renders down deployment script without pull or up flags", () => {
    const env = envFixture();
    const plan = buildWindowsDockerInstallPlan(
      configFixture(),
      env,
      renderWindowsDockerCompose(configFixture(), env),
      { action: "down" }
    );

    expect(plan.deploymentScript).toContain(
      "& $Docker compose -p $ProjectName -f $ComposeFile down --remove-orphans"
    );
    expect(plan.deploymentScript).not.toContain(" pull");
    expect(plan.deploymentScript).not.toContain(" up -d");
    expect(plan.deploymentScript).not.toContain("--volumes");
  });

  test("escapes dotenv values for remote compose env files", () => {
    const env = {
      ...envFixture(),
      githubPat: 'pat-"quoted"\\line\nnext'
    };

    expect(renderWindowsDockerComposeEnvFile(env)).toContain(
      'GITHUB_PAT="pat-\\"quoted\\"\\\\line\\nnext"'
    );
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
        repositoryAccess: "all",
        allowedRepositories: [],
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
