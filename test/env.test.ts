import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadDeploymentEnv } from "../src/lib/env.js";

const tempPaths: string[] = [];

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => T
): T {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("loadDeploymentEnv", () => {
  test("loads defaults when no .env file exists", () => {
    const env = withEnv(
      {
        GITHUB_PAT: undefined
      },
      () =>
        loadDeploymentEnv({
          envPath: "/nonexistent/.env",
          requirePat: false
        })
    );

    expect(env.githubApiUrl).toBe("https://api.github.com");
    expect(env.composeProjectName).toBe("github-runner-fleet");
    expect(env.runnerVersion).toBe("2.333.0");
    expect(env.githubPat).toBeUndefined();
    expect(env.raw).toMatchObject({
      GITHUB_API_URL: "https://api.github.com",
      SYNOLOGY_RUNNER_BASE_DIR: "/volume1/docker/github-runner-fleet",
      SYNOLOGY_PORT: "5001",
      SYNOLOGY_SECURE: "true",
      SYNOLOGY_CERT_VERIFY: "false",
      SYNOLOGY_DSM_VERSION: "7",
      SYNOLOGY_API_REPO: `${os.homedir()}/src/synology-api`,
      SYNOLOGY_PROJECT_DIR: "/volume1/docker/github-runner-fleet",
      SYNOLOGY_PROJECT_COMPOSE_FILE: "compose.yaml",
      SYNOLOGY_PROJECT_ENV_FILE: ".env",
      SYNOLOGY_INSTALL_PULL_IMAGES: "true",
      SYNOLOGY_INSTALL_FORCE_RECREATE: "true",
      SYNOLOGY_INSTALL_REMOVE_ORPHANS: "true",
      LINUX_DOCKER_RUNNER_BASE_DIR: "/srv/github-runner-fleet/linux-docker",
      LINUX_DOCKER_PORT: "22",
      LINUX_DOCKER_PROJECT_DIR: "/srv/github-runner-fleet/linux-docker",
      LINUX_DOCKER_PROJECT_COMPOSE_FILE: "compose.yaml",
      LINUX_DOCKER_PROJECT_ENV_FILE: ".env",
      LINUX_DOCKER_INSTALL_PULL_IMAGES: "true",
      LINUX_DOCKER_INSTALL_FORCE_RECREATE: "true",
      LINUX_DOCKER_INSTALL_REMOVE_ORPHANS: "true",
      LUME_RUNNER_BASE_DIR: `${os.homedir()}/Library/Application Support/github-runner-fleet/lume`,
      LUME_RUNNER_ENV_FILE: `${os.homedir()}/Library/Application Support/github-runner-fleet/lume/runner.env`,
      COMPOSE_PROJECT_NAME: "github-runner-fleet",
      RUNNER_VERSION: "2.333.0"
    });
  });

  test("throws when GITHUB_PAT is required but missing", () => {
    expect(() =>
      withEnv(
        {
          GITHUB_PAT: undefined
        },
        () =>
          loadDeploymentEnv({
            envPath: "/nonexistent/.env",
            requirePat: true
          })
      )
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

    const env = withEnv(
      {
        GITHUB_PAT: undefined
      },
      () => loadDeploymentEnv({ envPath, requirePat: true })
    );
    expect(env.githubPat).toBe("test-token");
    expect(env.runnerVersion).toBe("2.340.0");
  });

  test("strips trailing slashes from API URL", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synology-env-"));
    tempPaths.push(directory);
    const envPath = path.join(directory, ".env");

    fs.writeFileSync(envPath, "GITHUB_API_URL=https://ghe.example.com/api/v3///\n", "utf8");

    const env = withEnv(
      {
        GITHUB_API_URL: undefined
      },
      () =>
        loadDeploymentEnv({
          envPath,
          requirePat: false
        })
    );

    expect(env.githubApiUrl).toBe("https://ghe.example.com/api/v3");
  });

  test("derives Synology HTTP defaults when secure is disabled", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "synology-env-"));
    tempPaths.push(directory);
    const envPath = path.join(directory, ".env");

    fs.writeFileSync(envPath, "SYNOLOGY_SECURE=false\n", "utf8");

    const env = loadDeploymentEnv({
      envPath,
      requirePat: false
    });

    expect(env.synologySecure).toBe(false);
    expect(env.synologyPort).toBe("5000");
  });
});
