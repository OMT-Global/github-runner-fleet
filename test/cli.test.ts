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
  WINDOWS_DOCKER_RUNNER_BASE_DIR: undefined,
  WINDOWS_DOCKER_HOST: undefined,
  WINDOWS_DOCKER_USERNAME: undefined,
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

  test("prints autoscale dry-run decisions without changing the config file", async () => {
    const fixture = createCliFixture();
    const before = fs.readFileSync(fixture.synologyConfigPath, "utf8");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([{ full_name: "example/private-app" }])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              workflow_runs: [
                {
                  id: 42,
                  jobs_url:
                    "https://api.github.com/repos/example/private-app/actions/runs/42/jobs"
                }
              ]
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ workflow_runs: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jobs: [
                {
                  id: 1,
                  status: "queued",
                  runner_group_name: "synology-private",
                  labels: ["synology", "shell-only", "private"]
                }
              ]
            })
        })
    );

    const result = await invokeCli([
      "scale",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--pool",
      "synology-private",
      "--dry-run"
    ]);

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(fixture.synologyConfigPath, "utf8")).toBe(before);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        dryRun: true,
        pools: [
          expect.objectContaining({
            poolKey: "synology-private",
            action: "scale-up",
            currentSize: 1,
            targetSize: 2,
            queuedJobs: 1
          })
        ]
      })
    );
  });

  test("drains a pool and emits structured JSON status", async () => {
    const fixture = createCliFixture();
    const fetchMock = vi
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
                busy: false,
                runner_group_id: 7
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => ""
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeCli([
      "drain-pool",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--plane",
      "synology",
      "--pool",
      "synology-private",
      "--timeout",
      "15m",
      "--format",
      "json"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        plane: "synology",
        poolKey: "synology-private",
        status: "drained",
        timeoutSeconds: 900,
        cordoned: ["synology-private-runner-01"],
        busy: []
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/orgs/example/actions/runners/101",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("drain-pool exits non-zero on timeout", async () => {
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
              runner_groups: [{ id: 7, name: "synology-private" }]
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
                  busy: true,
                  runner_group_id: 7
                }
              ]
            })
        })
    );

    const result = await invokeCli([
      "drain-pool",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--plane",
      "synology",
      "--pool",
      "synology-private",
      "--timeout",
      "0",
      "--format",
      "json"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        status: "timeout",
        busy: ["synology-private-runner-01"]
      })
    );
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

  test("validates and renders Windows Docker commands without remote execution in dry-run mode", async () => {
    const fixture = createCliFixture();

    const validate = await invokeCli([
      "validate-windows-config",
      "--env",
      fixture.envPath,
      "--config",
      fixture.windowsConfigPath
    ]);
    expect(validate.error).toBeUndefined();
    expect(JSON.parse(validate.stdout)).toEqual(
      expect.objectContaining({
        plane: "windows-docker",
        pools: [
          expect.objectContaining({
            key: "windows-private",
            labels: ["windows", "docker-capable", "private", "x64"]
          })
        ]
      })
    );

    const compose = await invokeCli([
      "render-windows-compose",
      "--env",
      fixture.envPath,
      "--config",
      fixture.windowsConfigPath
    ]);
    expect(compose.error).toBeUndefined();
    expect(compose.stdout).toContain("windows-private-runner-01:");
    expect(compose.stdout).toContain("npipe:////./pipe/docker_engine");

    for (const command of [
      "render-windows-project-manifest",
      "install-windows-project",
      "teardown-windows-project"
    ]) {
      const result = await invokeCli([
        command,
        "--env",
        fixture.envPath,
        "--config",
        fixture.windowsConfigPath,
        ...(command === "render-windows-project-manifest" ? [] : ["--dry-run"])
      ]);
      const payload = JSON.parse(result.stdout) as {
        connection: { host: string; username: string };
        options: { action: string };
        deploymentScript: string;
      };

      expect(result.error).toBeUndefined();
      expect(payload.connection).toEqual(
        expect.objectContaining({
          host: "windows.example.com",
          username: "administrator"
        })
      );
      expect(payload.options.action).toBe(
        command === "teardown-windows-project" ? "down" : "up"
      );
      expect(payload.deploymentScript).toContain("& $Docker compose");
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
  windowsConfigPath: string;
  lumeConfigPath: string;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  tempPaths.push(directory);

  const envPath = path.join(directory, ".env");
  const synologyConfigPath = path.join(directory, "pools.yaml");
  const linuxConfigPath = path.join(directory, "linux-docker-runners.yaml");
  const windowsConfigPath = path.join(directory, "windows-runners.yaml");
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
WINDOWS_DOCKER_RUNNER_BASE_DIR=C:\\github-runner-fleet\\windows-docker
WINDOWS_DOCKER_HOST=windows.example.com
WINDOWS_DOCKER_USERNAME=administrator
WINDOWS_DOCKER_PROJECT_DIR=C:\\github-runner-fleet\\windows-docker
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
    scaling:
      min: 1
      max: 3
      queueThreshold: 1
      cooldownSeconds: 120
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
    windowsConfigPath,
    `version: 1
plane: windows-docker
pools:
  - name: windows-private
    group: windows-private
    repositoryAccess: selected
    repositories:
      - example/windows-app
    slots: 1
    host: \${WINDOWS_DOCKER_HOST}
    sshUser: \${WINDOWS_DOCKER_USERNAME}
    image: ghcr.io/example/github-runner-fleet:0.1.9-windows
    runnerRoot: \${WINDOWS_DOCKER_RUNNER_BASE_DIR}\\pools\\windows-private
    labels:
      - x64
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
    windowsConfigPath,
    lumeConfigPath
  };
}
