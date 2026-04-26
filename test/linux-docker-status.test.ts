import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DeploymentEnv } from "../src/lib/env.js";
import type { ResolvedLinuxDockerConfig } from "../src/lib/linux-docker-config.js";
import { renderLinuxDockerCompose } from "../src/lib/linux-docker-compose.js";
import {
  buildLinuxDockerStatusReport,
  formatLinuxDockerStatusText,
  saveLinuxDockerResult
} from "../src/lib/linux-docker-status.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("linux docker status", () => {
  test("summarizes saved install status and troubleshooting surfaces", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linux-docker-status-"));
    tempDirs.push(dir);
    const resultPath = path.join(dir, "status.json");

    saveLinuxDockerResult(resultPath, {
      ok: true,
      action: "up",
      remoteLogPath: "/srv/github-runner-fleet/linux-docker/logs/install-project.log",
      composePsOutput: "NAME STATUS\nrunner-01 Up 5 seconds",
      connection: {
        host: "docker-host.example.com",
        port: "22",
        username: "runner"
      },
      project: {
        name: "github-runner-fleet-linux-docker",
        directory: "/srv/github-runner-fleet/linux-docker"
      }
    });

    const env = envFixture();
    const report = buildLinuxDockerStatusReport({
      config: configFixture(),
      env,
      composeContent: renderLinuxDockerCompose(configFixture(), env),
      savedResultPath: resultPath
    });

    expect(report.ok).toBe(true);
    expect(report.savedResult?.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "saved_result", ok: true }),
        expect.objectContaining({ key: "recent_result", ok: true }),
        expect.objectContaining({ key: "recent_log", ok: true })
      ])
    );
    const rendered = formatLinuxDockerStatusText(report);
    expect(rendered).toContain("recent_action=up");
    expect(rendered).toContain("recent_compose_ps:");
    expect(rendered).toContain("troubleshooting:");
  });

  test("reports missing prerequisites and missing saved result clearly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linux-docker-status-missing-"));
    tempDirs.push(dir);
    const missingResult = path.join(dir, "missing.json");
    const env = envFixture();
    env.githubPat = undefined;
    env.linuxDockerHost = undefined;
    env.linuxDockerUsername = undefined;

    const report = buildLinuxDockerStatusReport({
      config: configFixture(),
      env,
      composeContent: renderLinuxDockerCompose(configFixture(), env),
      savedResultPath: missingResult
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "linux_docker_env", ok: false }),
        expect.objectContaining({ key: "github_pat", ok: false }),
        expect.objectContaining({ key: "saved_result_path", ok: false })
      ])
    );
  });

  test("surfaces saved failure details ahead of generic troubleshooting", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linux-docker-status-failed-"));
    tempDirs.push(dir);
    const resultPath = path.join(dir, "status.json");

    saveLinuxDockerResult(resultPath, {
      ok: false,
      action: "down",
      remoteLogPath: "/srv/github-runner-fleet/linux-docker/logs/install-project.log",
      error: "docker compose down failed"
    });

    const env = envFixture();
    const report = buildLinuxDockerStatusReport({
      config: configFixture(),
      env,
      composeContent: renderLinuxDockerCompose(configFixture(), env),
      savedResultPath: resultPath
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "recent_result",
          ok: false,
          summary: "latest Linux Docker down action failed"
        })
      ])
    );
    expect(report.troubleshooting[0]).toEqual({
      symptom: "Latest saved install attempt failed",
      nextStep:
        "Start with /srv/github-runner-fleet/linux-docker/logs/install-project.log and the saved error: docker compose down failed"
    });
    expect(formatLinuxDockerStatusText(report)).toContain(
      "recent_error=docker compose down failed"
    );
  });

  test("allows config-only status without a saved result path", () => {
    const env = envFixture();
    const report = buildLinuxDockerStatusReport({
      config: configFixture(),
      env,
      composeContent: renderLinuxDockerCompose(configFixture(), env)
    });

    expect(report.ok).toBe(true);
    expect(report.savedResultPath).toBeUndefined();
    expect(report.savedResult).toBeUndefined();
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "saved_result_path",
        ok: true
      })
    );
    expect(formatLinuxDockerStatusText(report)).not.toContain("recent_action=");
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
    windowsDockerRunnerBaseDir: "C:\\github-runner-fleet\\windows",
    windowsDockerHost: "windows-host.example.com",
    windowsDockerPort: "22",
    windowsDockerUsername: "runner",
    windowsDockerProjectDir: "C:\\github-runner-fleet\\windows",
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
