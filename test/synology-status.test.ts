import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { renderCompose } from "../src/lib/compose.js";
import type { ResolvedConfig } from "../src/lib/config.js";
import type { DeploymentEnv } from "../src/lib/env.js";
import {
  buildSynologyStatusReport,
  formatSynologyStatusText,
  saveSynologyResult
} from "../src/lib/synology-status.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("synology status", () => {
  test("summarizes saved install status and troubleshooting surfaces", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synology-status-"));
    tempDirs.push(dir);
    const apiRepo = path.join(dir, "synology-api");
    fs.mkdirSync(apiRepo, { recursive: true });
    const resultPath = path.join(dir, "status.json");

    saveSynologyResult(
      resultPath,
      "up",
      JSON.stringify({
        ok: true,
        project: {
          name: "synology-github-runner",
          status: "running",
          updated_at: "2026-04-12T08:00:00Z"
        },
        task: {
          id: 77,
          result: {
            exit_code: 0,
            start_time: "2026-04-12T07:59:00Z",
            end_time: "2026-04-12T08:00:00Z"
          }
        },
        remoteLogPath: "/volume1/docker/synology-github-runner/logs/install-project.log"
      })
    );

    const env = envFixture(apiRepo);
    const report = buildSynologyStatusReport({
      config: configFixture(),
      env,
      composeContent: renderCompose(configFixture(), env),
      savedResultPath: resultPath
    });

    expect(report.ok).toBe(true);
    expect(report.savedResult?.task?.result?.exit_code).toBe(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "saved_result", ok: true }),
        expect.objectContaining({ key: "recent_task", ok: true }),
        expect.objectContaining({ key: "recent_project", ok: true })
      ])
    );
    expect(formatSynologyStatusText(report)).toContain("recent_task exit_code=0");
    expect(formatSynologyStatusText(report)).toContain("troubleshooting:");
  });

  test("reports missing prerequisites and missing saved result clearly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synology-status-missing-"));
    tempDirs.push(dir);
    const missingResult = path.join(dir, "missing.json");
    const env = envFixture(path.join(dir, "missing-api"));
    env.githubPat = undefined;
    env.synologyHost = undefined;
    env.synologyUsername = undefined;
    env.synologyPassword = undefined;

    const report = buildSynologyStatusReport({
      config: configFixture(),
      env,
      composeContent: renderCompose(configFixture(), env),
      savedResultPath: missingResult
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "synology_env", ok: false }),
        expect.objectContaining({ key: "github_pat", ok: false }),
        expect.objectContaining({ key: "synology_api_repo", ok: false }),
        expect.objectContaining({ key: "saved_result_path", ok: false })
      ])
    );
  });

  test("fails github_pat when GitHub auth is missing but Synology auth is configured", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synology-status-github-pat-"));
    tempDirs.push(dir);
    const apiRepo = path.join(dir, "synology-api");
    fs.mkdirSync(apiRepo, { recursive: true });
    const env = envFixture(apiRepo);
    env.githubPat = undefined;

    const report = buildSynologyStatusReport({
      config: configFixture(),
      env,
      composeContent: renderCompose(configFixture(), env)
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "synology_env",
          ok: true
        }),
        expect.objectContaining({
          key: "github_pat",
          ok: false,
          summary: "GITHUB_PAT is missing from the deployment env"
        })
      ])
    );
  });
});

function configFixture(): ResolvedConfig {
  return {
    version: 1,
    image: {
      repository: "ghcr.io/example/synology-github-runner",
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
        labels: ["synology", "shell-only", "private"],
        size: 1,
        architecture: "auto",
        runnerRoot: "/volume1/docker/synology-github-runner/pools/synology-private",
        resources: {
          memory: "2g"
        },
        imageRef: "ghcr.io/example/synology-github-runner:0.1.9"
      }
    ]
  };
}

function envFixture(apiRepo: string): DeploymentEnv {
  return {
    githubPat: "test-pat",
    githubApiUrl: "https://api.github.com",
    synologyRunnerBaseDir: "/volume1/docker/synology-github-runner",
    synologyHost: "nas.example.com",
    synologyPort: "5001",
    synologyUsername: "admin",
    synologyPassword: "secret",
    synologySecure: true,
    synologyCertVerify: false,
    synologyDsmVersion: 7,
    synologyApiRepo: apiRepo,
    synologyProjectDir: "/volume1/docker/synology-github-runner",
    synologyProjectComposeFile: "compose.yaml",
    synologyProjectEnvFile: ".env",
    synologyInstallPullImages: true,
    synologyInstallForceRecreate: true,
    synologyInstallRemoveOrphans: true,
    lumeRunnerBaseDir:
      "/Users/tester/Library/Application Support/synology-github-runner/lume",
    lumeRunnerEnvFile:
      "/Users/tester/Library/Application Support/synology-github-runner/lume/runner.env",
    composeProjectName: "synology-github-runner",
    runnerVersion: "2.333.0",
    raw: {}
  };
}
