import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadDeploymentEnv } from "../src/lib/env.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadDeploymentEnv", () => {
  test("loads defaults when no .env file exists", () => {
    const env = loadDeploymentEnv({
      envPath: "/nonexistent/.env",
      requirePat: false
    });

    expect(env.githubApiUrl).toBe("https://api.github.com");
    expect(env.composeProjectName).toBe("synology-github-runner");
    expect(env.runnerVersion).toBe("2.333.0");
    expect(env.githubPat).toBeUndefined();
  });

  test("throws when GITHUB_PAT is required but missing", () => {
    expect(() =>
      loadDeploymentEnv({
        envPath: "/nonexistent/.env",
        requirePat: true
      })
    ).toThrow(/GITHUB_PAT is required/);
  });

  test("reads values from .env file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synology-env-"));
    tempPaths.push(directory);
    const envPath = path.join(directory, ".env");

    fs.writeFileSync(
      envPath,
      "GITHUB_PAT=test-token\nRUNNER_VERSION=v2.340.0\n",
      "utf8"
    );

    const env = loadDeploymentEnv({ envPath, requirePat: true });
    expect(env.githubPat).toBe("test-token");
    expect(env.runnerVersion).toBe("2.340.0");
  });

  test("strips trailing slashes from API URL", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synology-env-"));
    tempPaths.push(directory);
    const envPath = path.join(directory, ".env");
    const previousGithubApiUrl = process.env.GITHUB_API_URL;

    fs.writeFileSync(envPath, "GITHUB_API_URL=https://ghe.example.com/api/v3///\n", "utf8");
    delete process.env.GITHUB_API_URL;

    try {
      const env = loadDeploymentEnv({ envPath, requirePat: false });
      expect(env.githubApiUrl).toBe("https://ghe.example.com/api/v3");
    } finally {
      if (previousGithubApiUrl === undefined) {
        delete process.env.GITHUB_API_URL;
      } else {
        process.env.GITHUB_API_URL = previousGithubApiUrl;
      }
    }
  });
});
