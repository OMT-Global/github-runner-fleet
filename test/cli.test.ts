import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/cli.js";

const tempPaths: string[] = [];

const cleanEnv: Record<string, string | undefined> = {
  GITHUB_PAT: undefined,
  GITHUB_TOKEN: undefined,
  GH_TOKEN: undefined,
  GITHUB_API_URL: undefined,
  SYNOLOGY_RUNNER_BASE_DIR: undefined,
  SYNOLOGY_HOST: undefined,
  SYNOLOGY_USERNAME: undefined,
  SYNOLOGY_PASSWORD: undefined,
  LINUX_DOCKER_RUNNER_BASE_DIR: undefined,
  LINUX_DOCKER_HOST: undefined,
  LINUX_DOCKER_USERNAME: undefined,
  LUME_RUNNER_BASE_DIR: undefined,
  LUME_RUNNER_ENV_FILE: undefined,
  DRIFT_NOTIFY_CHANNEL: undefined,
  GITHUB_STEP_SUMMARY: undefined,
  METRICS_ENDPOINT: undefined,
  RUNNER_VERSION: undefined,
  COMPOSE_PROJECT_NAME: undefined
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("cli integration", () => {
  test("prints usage and exits non-zero for missing command", async () => {
    const result = await invokeCli([]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("pnpm doctor");
    expect(result.stdout).toBe("");
    expect(result.error).toBeUndefined();
  });

  test("validates Synology config from explicit env and config paths", async () => {
    const fixture = createCliFixture();
    const result = await invokeCli([
      "validate-config",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath
    ]);

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout) as {
      pools: Array<{ key: string; labels: string[]; runnerRoot: string }>;
    };
    expect(payload.pools).toHaveLength(1);
    expect(payload.pools[0]).toEqual(
      expect.objectContaining({
        key: "synology-private",
        labels: ["synology", "shell-only", "private", "custom-label"],
        runnerRoot: path.join(fixture.directory, "synology", "pools", "synology-private")
      })
    );
  });

  test("renders Synology compose output to a requested file", async () => {
    const fixture = createCliFixture();
    const outputPath = path.join(fixture.directory, "compose.generated.yml");
    const result = await invokeCli([
      "render-compose",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--output",
      outputPath
    ]);

    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe(`${outputPath}\n`);
    expect(fs.readFileSync(outputPath, "utf8")).toContain("synology-private-runner-01:");
  });

  test("renders dry-run install summaries for operator-facing commands", async () => {
    const fixture = createCliFixture();

    const cases = [
      {
        command: "render-synology-project-manifest",
        config: fixture.synologyConfigPath,
        expectedAction: "up"
      },
      {
        command: "install-synology-project",
        config: fixture.synologyConfigPath,
        expectedAction: "up",
        extraArgs: ["--dry-run"]
      },
      {
        command: "teardown-synology-project",
        config: fixture.synologyConfigPath,
        expectedAction: "down",
        extraArgs: ["--dry-run"]
      }
    ];

    for (const entry of cases) {
      const result = await invokeCli([
        entry.command,
        "--env",
        fixture.envPath,
        "--config",
        entry.config,
        ...(entry.extraArgs ?? [])
      ]);

      expect(result.error).toBeUndefined();
      const payload = JSON.parse(result.stdout) as {
        options: { action: string };
        envFilePreview: string;
      };
      expect(payload.options.action).toBe(entry.expectedAction);
      expect(payload.envFilePreview).toContain("GITHUB_PAT=<redacted>");
    }
  });

  test("validates and renders Linux Docker commands without remote execution in dry-run mode", async () => {
    const fixture = createCliFixture();

    const validate = await invokeCli([
      "validate-linux-docker-config",
      "--env",
      fixture.envPath,
      "--config",
      fixture.linuxConfigPath
    ]);
    expect(validate.error).toBeUndefined();
    expect(JSON.parse(validate.stdout)).toEqual(
      expect.objectContaining({
        pools: [
          expect.objectContaining({
            key: "linux-private",
            labels: ["linux", "docker-capable", "private", "docker-host"]
          })
        ]
      })
    );

    const compose = await invokeCli([
      "render-linux-docker-compose",
      "--env",
      fixture.envPath,
      "--config",
      fixture.linuxConfigPath
    ]);
    expect(compose.error).toBeUndefined();
    expect(compose.stdout).toContain("linux-private-runner-01:");

    for (const command of [
      "render-linux-docker-project-manifest",
      "install-linux-docker-project",
      "teardown-linux-docker-project"
    ]) {
      const result = await invokeCli([
        command,
        "--env",
        fixture.envPath,
        "--config",
        fixture.linuxConfigPath,
        ...(command === "render-linux-docker-project-manifest" ? [] : ["--dry-run"])
      ]);
      const payload = JSON.parse(result.stdout) as {
        connection: { host: string; username: string };
        options: { action: string };
        deploymentScript: string;
      };

      expect(result.error).toBeUndefined();
      expect(payload.connection).toEqual(
        expect.objectContaining({
          host: "linux.example.com",
          username: "runner-admin"
        })
      );
      expect(payload.options.action).toBe(
        command === "teardown-linux-docker-project" ? "down" : "up"
      );
      expect(payload.deploymentScript).toContain('"$docker_bin" compose');
    }
  });

  test("validates Lume config and renders slot manifests in JSON and shell formats", async () => {
    const fixture = createCliFixture();

    const validate = await invokeCli([
      "validate-lume-config",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath
    ]);
    expect(validate.error).toBeUndefined();
    expect(JSON.parse(validate.stdout)).toEqual(
      expect.objectContaining({
        pool: expect.objectContaining({
          key: "macos-private",
          labels: ["self-hosted", "macos", "arm64", "private", "xcode"]
        })
      })
    );

    const slotJson = await invokeCli([
      "render-lume-runner-manifest",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--slot",
      "1"
    ]);
    expect(slotJson.error).toBeUndefined();
    expect(JSON.parse(slotJson.stdout)).toEqual(
      expect.objectContaining({
        slot: expect.objectContaining({
          index: 1,
          slotKey: "slot-01",
          vmName: "macos-runner-slot-01"
        })
      })
    );

    const shell = await invokeCli([
      "render-lume-runner-manifest",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--slot",
      "1",
      "--format",
      "shell"
    ]);
    expect(shell.error).toBeUndefined();
    expect(shell.stdout).toContain("export LUME_SLOT_INDEX='1'");
    expect(shell.stdout).toContain("export RUNNER_LABELS='self-hosted,macos,arm64,private,xcode'");
  });

  test("surfaces CLI option errors before mutating state", async () => {
    const fixture = createCliFixture();

    const missingValue = await invokeCli(["validate-config", "--config"]);
    expect(missingValue.error).toMatchObject({
      message: "missing value for --config"
    });

    const invalidDoctorFormat = await invokeCli([
      "doctor",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--format",
      "yaml"
    ]);
    expect(invalidDoctorFormat.error).toMatchObject({
      message: "unknown doctor format: yaml"
    });

    const missingLumeSlot = await invokeCli([
      "render-lume-runner-manifest",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--format",
      "shell"
    ]);
    expect(missingLumeSlot.error).toMatchObject({
      message: "--slot is required when --format shell is used"
    });
  });

  test("renders runner release commands with GitHub responses mocked at the CLI boundary", async () => {
    const fixture = createCliFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            tag_name: "v2.334.0",
            published_at: "2026-04-20T00:00:00Z",
            html_url: "https://github.com/actions/runner/releases/tag/v2.334.0"
          })
      }))
    );

    const version = await invokeCli([
      "check-runner-version",
      "--env",
      fixture.envPath,
      "--current",
      "2.333.0"
    ]);
    expect(version.error).toBeUndefined();
    expect(JSON.parse(version.stdout)).toEqual(
      expect.objectContaining({
        current: "2.333.0",
        latest: "2.334.0",
        outdated: true,
        publishedAt: "2026-04-20T00:00:00Z"
      })
    );

    const manifest = await invokeCli([
      "runner-release-manifest",
      "--env",
      fixture.envPath,
      "--current",
      "2.334.0"
    ]);
    expect(manifest.error).toBeUndefined();
    expect(JSON.parse(manifest.stdout)).toEqual(
      expect.objectContaining({
        current: "2.334.0",
        latest: "2.334.0",
        outdated: false,
        assets: expect.objectContaining({
          amd64: expect.stringContaining("actions-runner-linux-x64-2.334.0.tar.gz"),
          arm64: expect.stringContaining("actions-runner-linux-arm64-2.334.0.tar.gz")
        })
      })
    );
  });

  test("runs drift detection and exits zero when desired state matches actual state", async () => {
    const fixture = createCliFixture();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                {
                  id: 7,
                  name: "synology-private",
                  visibility: "all",
                  default: false
                }
              ]
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runners: [
                {
                  id: 101,
                  name: "synology-private-runner-01",
                  status: "online",
                  runner_group_id: 7
                },
                {
                  id: 102,
                  name: "synology-private-runner-02",
                  status: "offline",
                  runner_group_id: 7
                }
              ]
            })
        })
    );

    const result = await invokeCli([
      "drift-detect",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual({
      pools: [
        {
          name: "synology-private",
          desired: 1,
          actual: 1,
          drift: 0,
          status: "ok"
        }
      ],
      drifted: false
    });
  });

  test("drift detection returns exit code 1 for under-provisioned pools", async () => {
    const fixture = createCliFixture();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                {
                  id: 7,
                  name: "synology-private",
                  visibility: "all",
                  default: false
                }
              ]
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ runners: [] })
        })
    );

    const result = await invokeCli([
      "drift-detect",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        drifted: true,
        pools: [
          expect.objectContaining({
            actual: 0,
            drift: -1,
            status: "under-provisioned"
          })
        ]
      })
    );
  });

  test("drift detection writes an opt-in step summary notification", async () => {
    const fixture = createCliFixture();
    const stepSummaryPath = path.join(fixture.directory, "step-summary.md");
    fs.appendFileSync(
      fixture.envPath,
      `DRIFT_NOTIFY_CHANNEL=github-step-summary\nGITHUB_STEP_SUMMARY=${stepSummaryPath}\n`,
      "utf8"
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                {
                  id: 7,
                  name: "synology-private",
                  visibility: "all",
                  default: false
                }
              ]
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ runners: [] })
        })
    );

    const result = await invokeCli([
      "drift-detect",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(fs.readFileSync(stepSummaryPath, "utf8")).toContain(
      "| synology-private | 1 | 0 | -1 | under-provisioned |"
    );
    expect(fs.readFileSync(stepSummaryPath, "utf8")).toContain(
      "Notification channel configured."
    );
  });
});

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: string | number | undefined;
  error: unknown;
}

async function invokeCli(args: string[]): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  let error: unknown;
  const previousExitCode = process.exitCode;

  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });

  try {
    process.exitCode = undefined;
    await withEnv(cleanEnv, async () => {
      await main(args);
    });
  } catch (caught) {
    error = caught;
  }

  const exitCode = process.exitCode;
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = previousExitCode;

  return { stdout, stderr, exitCode, error };
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>
): Promise<T> {
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
    return await callback();
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

function createCliFixture(): {
  directory: string;
  envPath: string;
  synologyConfigPath: string;
  linuxConfigPath: string;
  lumeConfigPath: string;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  tempPaths.push(directory);

  const envPath = path.join(directory, ".env");
  const synologyConfigPath = path.join(directory, "pools.yaml");
  const linuxConfigPath = path.join(directory, "linux-docker-runners.yaml");
  const lumeConfigPath = path.join(directory, "lume-runners.yaml");

  fs.writeFileSync(
    envPath,
    `GITHUB_PAT=secret
SYNOLOGY_RUNNER_BASE_DIR=${directory}/synology
SYNOLOGY_HOST=nas.example.com
SYNOLOGY_USERNAME=admin
SYNOLOGY_PASSWORD=secret
LINUX_DOCKER_RUNNER_BASE_DIR=${directory}/linux
LINUX_DOCKER_HOST=linux.example.com
LINUX_DOCKER_USERNAME=runner-admin
LUME_RUNNER_BASE_DIR=${directory}/lume
LUME_RUNNER_ENV_FILE=${directory}/lume/runner.env
RUNNER_VERSION=2.333.0
COMPOSE_PROJECT_NAME=github-runner-fleet-test
`,
    "utf8"
  );

  fs.writeFileSync(
    synologyConfigPath,
    `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: synology-private
    visibility: private
    organization: example
    runnerGroup: synology-private
    repositoryAccess: all
    labels:
      - shell-only
      - custom-label
    size: 1
    architecture: auto
    runnerRoot: \${SYNOLOGY_RUNNER_BASE_DIR}/pools/synology-private
`,
    "utf8"
  );

  fs.writeFileSync(
    linuxConfigPath,
    `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-private
    organization: example
    runnerGroup: linux-private
    repositoryAccess: selected
    allowedRepositories:
      - example/private-app
    labels:
      - docker-host
    size: 1
    architecture: amd64
    runnerRoot: \${LINUX_DOCKER_RUNNER_BASE_DIR}/private
`,
    "utf8"
  );

  fs.writeFileSync(
    lumeConfigPath,
    `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  labels:
    - xcode
  size: 1
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
    "utf8"
  );

  return {
    directory,
    envPath,
    synologyConfigPath,
    linuxConfigPath,
    lumeConfigPath
  };
}
