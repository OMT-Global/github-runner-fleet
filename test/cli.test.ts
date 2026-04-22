import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { main } from "../src/cli.js";

const tempPaths: string[] = [];

const cleanEnv: Record<string, string | undefined> = {
  GITHUB_PAT: undefined,
  GITHUB_PAT_NEXT: undefined,
  NEW_GITHUB_PAT: undefined,
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
      const logs = parseJsonLogLines(result.stderr);
      if (entry.extraArgs?.includes("--dry-run")) {
        expect(logs).toEqual([
          expect.objectContaining({
            component: "controller",
            command: entry.command,
            action: entry.expectedAction === "down" ? "teardown" : "install",
            plane: "synology",
            pool: "all",
            status: "dry-run",
            dryRun: true
          })
        ]);
      } else {
        expect(logs).toEqual([]);
      }
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
    expect(parseJsonLogLines(result.stderr)).toEqual([
      expect.objectContaining({
        component: "controller",
        command: "scale",
        action: "autoscale",
        plane: "synology",
        pool: "synology-private",
        status: "started",
        dryRun: true
      }),
      expect.objectContaining({
        component: "controller",
        command: "scale",
        action: "autoscale",
        plane: "synology",
        pool: "synology-private",
        status: "completed",
        decisionCount: 1,
        scaleUp: 1,
        scaleDown: 0,
        drains: 0
      })
    ]);
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

  test("builds a token rotation dry-run plan after validating the replacement PAT", async () => {
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
              },
              {
                id: 8,
                name: "linux-private",
                visibility: "selected",
                default: false
              },
              {
                id: 9,
                name: "macos-private",
                visibility: "selected",
                default: false
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ token: "registration-token" })
      });
    vi.stubGlobal("fetch", fetchMock);
    fs.appendFileSync(fixture.envPath, "NEW_GITHUB_PAT=replacement-secret\n", "utf8");

    const result = await invokeCli([
      "rotate-token",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--linux-config",
      fixture.linuxConfigPath,
      "--lume-config",
      fixture.lumeConfigPath
    ]);

    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain('"command":"rotate-token"');
    const payload = JSON.parse(result.stdout) as {
      dryRun: boolean;
      tokenEnv: string;
      validation: { registrationTokenOrganizations: string[] };
      pools: Array<{ plane: string; key: string; runnerNames: string[] }>;
      drains: unknown[];
    };
    expect(payload.dryRun).toBe(true);
    expect(payload.tokenEnv).toBe("NEW_GITHUB_PAT");
    expect(payload.validation.registrationTokenOrganizations).toEqual(["example"]);
    expect(payload.pools).toEqual([
      expect.objectContaining({
        plane: "synology",
        key: "synology-private",
        runnerNames: ["synology-private-runner-01"]
      }),
      expect.objectContaining({
        plane: "linux-docker",
        key: "linux-private",
        runnerNames: ["linux-private-runner-01"]
      }),
      expect.objectContaining({
        plane: "lume",
        key: "macos-private",
        runnerNames: ["macos-runner-slot-01"]
      })
    ]);
    expect(payload.drains).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/orgs/example/actions/runners/registration-token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer replacement-secret"
        })
      })
    );
  });

  test("rejects conflicting token rotation modes", async () => {
    const result = await invokeCli(["rotate-token", "--apply", "--dry-run"]);

    expect(result.error).toEqual(
      new Error("pass either --apply or --dry-run, not both")
    );
    expect(result.stdout).toBe("");
  });

  test("rejects an unknown token rotation plane", async () => {
    const fixture = createCliFixture();
    fs.appendFileSync(fixture.envPath, "NEW_GITHUB_PAT=replacement-secret\n", "utf8");

    const result = await invokeCli([
      "rotate-token",
      "--env",
      fixture.envPath,
      "--plane",
      "windows-docker"
    ]);

    expect(result.error).toEqual(
      new Error("unknown rotate-token plane: windows-docker")
    );
    expect(result.stdout).toBe("");
  });

  test("filters token rotation to an explicit pool and token env", async () => {
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
        status: 201,
        text: async () => JSON.stringify({ token: "registration-token" })
      });
    vi.stubGlobal("fetch", fetchMock);
    fs.appendFileSync(fixture.envPath, "GITHUB_PAT_NEXT=next-secret\n", "utf8");

    const result = await invokeCli([
      "rotate-token",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--linux-config",
      fixture.linuxConfigPath,
      "--lume-config",
      fixture.lumeConfigPath,
      "--new-token-env",
      "GITHUB_PAT_NEXT",
      "--plane",
      "synology",
      "--pool",
      "synology-private"
    ]);

    expect(result.error).toBeUndefined();
    const payload = JSON.parse(result.stdout) as {
      tokenEnv: string;
      pools: Array<{ plane: string; key: string; runnerNames: string[] }>;
    };
    expect(payload.tokenEnv).toBe("GITHUB_PAT_NEXT");
    expect(payload.pools).toEqual([
      expect.objectContaining({
        plane: "synology",
        key: "synology-private",
        runnerNames: ["synology-private-runner-01"]
      })
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/orgs/example/actions/runners/registration-token",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer next-secret"
        })
      })
    );
  });

  test("rejects an unknown token rotation pool", async () => {
    const fixture = createCliFixture();
    fs.appendFileSync(fixture.envPath, "NEW_GITHUB_PAT=replacement-secret\n", "utf8");

    const result = await invokeCli([
      "rotate-token",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--pool",
      "missing-pool"
    ]);

    expect(result.error).toEqual(new Error("unknown pool: missing-pool"));
    expect(result.stdout).toBe("");
  });

  test("drains the retiring runner before applying scale-in", async () => {
    const fixture = createCliFixture();
    fs.writeFileSync(
      fixture.synologyConfigPath,
      fs
        .readFileSync(fixture.synologyConfigPath, "utf8")
        .replace("    size: 1", "    size: 2"),
      "utf8"
    );
    const oldConfigTime = new Date(Date.now() - 300_000);
    fs.utimesSync(fixture.synologyConfigPath, oldConfigTime, oldConfigTime);

    const fetchMock = vi
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
        text: async () => JSON.stringify({ workflow_runs: [] })
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
                id: 102,
                name: "synology-private-runner-02",
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
      "scale",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--pool",
      "synology-private",
      "--drain-timeout",
      "0",
      "--python",
      "true"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "https://api.github.com/orgs/example/actions/runners/102",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        dryRun: false,
        pools: [
          expect.objectContaining({
            poolKey: "synology-private",
            action: "scale-down",
            currentSize: 2,
            targetSize: 1
          })
        ],
        drains: [
          expect.objectContaining({
            poolKey: "synology-private",
            status: "drained",
            cordoned: ["synology-private-runner-02"],
            busy: []
          })
        ]
      })
    );
    expect(fs.readFileSync(fixture.synologyConfigPath, "utf8")).toContain(
      "size: 1"
    );
  });

  test("stops scale-in when the retiring runner does not drain", async () => {
    const fixture = createCliFixture();
    fs.writeFileSync(
      fixture.synologyConfigPath,
      fs
        .readFileSync(fixture.synologyConfigPath, "utf8")
        .replace("    size: 1", "    size: 2"),
      "utf8"
    );
    const before = fs.readFileSync(fixture.synologyConfigPath, "utf8");
    const oldConfigTime = new Date(Date.now() - 300_000);
    fs.utimesSync(fixture.synologyConfigPath, oldConfigTime, oldConfigTime);

    const fetchMock = vi
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
        text: async () => JSON.stringify({ workflow_runs: [] })
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
                id: 102,
                name: "synology-private-runner-02",
                status: "online",
                busy: true,
                runner_group_id: 7
              }
            ]
          })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeCli([
      "scale",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--pool",
      "synology-private",
      "--drain-timeout",
      "0",
      "--python",
      "true"
    ]);

    expect(result.error).toEqual(
      new Error(
        "timed out waiting for synology-private-runner-02 to become idle before scaling synology-private down"
      )
    );
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fs.readFileSync(fixture.synologyConfigPath, "utf8")).toBe(before);
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
    expect(parseJsonLogLines(result.stderr)).toEqual([
      expect.objectContaining({
        component: "controller",
        command: "drain-pool",
        action: "drain",
        plane: "synology",
        pool: "synology-private",
        status: "started"
      }),
      expect.objectContaining({
        component: "controller",
        command: "drain-pool",
        action: "drain",
        plane: "synology",
        pool: "synology-private",
        msg: "drain synology/synology-private: drained",
        drainStatus: "drained",
        cordoned: 1,
        busy: 0,
        missing: 0
      }),
      expect.objectContaining({
        component: "controller",
        command: "drain-pool",
        action: "drain",
        plane: "synology",
        pool: "synology-private",
        status: "completed",
        drainStatus: "drained",
        total: 1,
        cordoned: 1,
        busy: 0,
        missing: 0
      })
    ]);
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

  test.each([
    {
      plane: "linux-docker",
      pool: "linux-private",
      configFlag: "--linux-config",
      configPath: (fixture: ReturnType<typeof createCliFixture>) =>
        fixture.linuxConfigPath,
      runnerGroup: "linux-private",
      runnerName: "linux-private-runner-01"
    },
    {
      plane: "lume",
      pool: "macos-private",
      configFlag: "--lume-config",
      configPath: (fixture: ReturnType<typeof createCliFixture>) =>
        fixture.lumeConfigPath,
      runnerGroup: "macos-private",
      runnerName: "macos-runner-slot-01"
    }
  ])(
    "drain-pool resolves $plane runner names from plane config",
    async ({ plane, pool, configFlag, configPath, runnerGroup, runnerName }) => {
      const fixture = createCliFixture();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [{ id: 7, name: runnerGroup }]
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
                  name: runnerName,
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
        configFlag,
        configPath(fixture),
        "--plane",
        plane,
        "--pool",
        pool,
        "--timeout",
        "15m",
        "--format",
        "json"
      ]);

      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBeUndefined();
      expect(JSON.parse(result.stdout)).toEqual(
        expect.objectContaining({
          plane,
          poolKey: pool,
          status: "drained",
          cordoned: [runnerName]
        })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "https://api.github.com/orgs/example/actions/runners/101",
        expect.objectContaining({ method: "DELETE" })
      );
    }
  );

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
        host: expect.objectContaining({
          baseDir: path.join(fixture.directory, "lume")
        }),
        pool: expect.objectContaining({
          key: "macos-private",
          labels: ["self-hosted", "macos", "arm64", "private", "xcode"]
        })
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runner_groups: [
              {
                id: 7,
                name: "macos-private",
                visibility: "selected",
                default: false
              }
            ]
          })
      }))
    );
    const github = await invokeCli([
      "validate-lume-github",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath
    ]);
    expect(github.error).toBeUndefined();
    expect(JSON.parse(github.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        pools: [
          expect.objectContaining({
            poolKey: "macos-private",
            visibility: "selected"
          })
        ]
      })
    );

    const fullJson = await invokeCli([
      "render-lume-runner-manifest",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath
    ]);
    expect(fullJson.error).toBeUndefined();
    expect(JSON.parse(fullJson.stdout)).toEqual(
      expect.objectContaining({
        pool: expect.objectContaining({
          key: "macos-private"
        }),
        slots: [
          expect.objectContaining({
            slotKey: "slot-01"
          })
        ]
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

  test("renders Lume install and teardown lifecycle results in dry-run mode", async () => {
    const fixture = createCliFixture();
    const resultPath = path.join(fixture.directory, "lume-result.json");

    const install = await invokeCli([
      "install-lume-project",
      "--env",
      fixture.envPath,
      "--lume-config",
      fixture.lumeConfigPath,
      "--status-output",
      resultPath,
      "--format",
      "json",
      "--dry-run"
    ]);
    expect(install.error).toBeUndefined();
    const installPayload = JSON.parse(install.stdout) as {
      action: string;
      status: string;
      resultPath: string;
      pool: { key: string; size: number };
      slots: Array<{ vmName: string; runnerName: string }>;
    };
    expect(installPayload).toEqual(
      expect.objectContaining({
        action: "install",
        status: "dry-run",
        resultPath,
        pool: expect.objectContaining({
          key: "macos-private",
          size: 1
        }),
        slots: [
          expect.objectContaining({
            vmName: "macos-runner-slot-01",
            runnerName: "macos-runner-slot-01"
          })
        ]
      })
    );
    expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toEqual(
      expect.objectContaining({
        action: "install",
        status: "dry-run"
      })
    );

    const teardown = await invokeCli([
      "teardown-lume-project",
      "--env",
      fixture.envPath,
      "--lume-config",
      fixture.lumeConfigPath,
      "--status-output",
      resultPath,
      "--format",
      "text",
      "--dry-run"
    ]);
    expect(teardown.error).toBeUndefined();
    expect(teardown.stdout).toContain("lume-project action=teardown status=dry-run");
    expect(teardown.stdout).toContain("pool=macos-private slots=1");
    expect(JSON.parse(fs.readFileSync(resultPath, "utf8"))).toEqual(
      expect.objectContaining({
        action: "teardown",
        status: "dry-run"
      })
    );

    const defaultOutput = await invokeCli([
      "install-lume-project",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--dry-run"
    ]);
    expect(defaultOutput.error).toBeUndefined();
    expect(defaultOutput.stdout).toContain("lume-project action=install status=dry-run");
    expect(JSON.parse(fs.readFileSync(
      path.join(fixture.directory, "lume", "lume-project-result.json"),
      "utf8"
    ))).toEqual(
      expect.objectContaining({
        action: "install",
        status: "dry-run"
      })
    );

    fs.mkdirSync(path.join(fixture.directory, "lume"), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.directory, "lume", "lume-project.pid"),
      `${process.pid}\n`,
      "utf8"
    );
    const alreadyRunning = await invokeCli([
      "install-lume-project",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--format",
      "json"
    ]);
    expect(alreadyRunning.error).toBeUndefined();
    expect(JSON.parse(alreadyRunning.stdout)).toEqual(
      expect.objectContaining({
        action: "install",
        status: "already-running",
        supervisorPid: process.pid
      })
    );
  });

  test("renders Lume drain status in text format when runners are already absent", async () => {
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
              runner_groups: [{ id: 7, name: "macos-private" }]
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ runners: [] })
        })
    );

    const result = await invokeCli([
      "drain-pool",
      "--env",
      fixture.envPath,
      "--lume-config",
      fixture.lumeConfigPath,
      "--plane",
      "lume",
      "--pool",
      "macos-private",
      "--format",
      "text"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain("drain lume/macos-private: drained");
    expect(result.stdout).toContain("already absent: macos-runner-slot-01");
    expect(result.stderr).toContain("drain lume/macos-private: drained");
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

    const invalidDoctorMode = await invokeCli(["doctor", "network"]);
    expect(invalidDoctorMode.error).toMatchObject({
      message: "unknown doctor mode: network"
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

    const invalidLumeSlot = await invokeCli([
      "render-lume-runner-manifest",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--slot",
      "9"
    ]);
    expect(invalidLumeSlot.error).toMatchObject({
      message: "slot 9 is outside configured pool size 1"
    });

    const invalidLumeProjectFormat = await invokeCli([
      "install-lume-project",
      "--env",
      fixture.envPath,
      "--config",
      fixture.lumeConfigPath,
      "--format",
      "yaml",
      "--dry-run"
    ]);
    expect(invalidLumeProjectFormat.error).toMatchObject({
      message: "unknown Lume project format: yaml"
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

  test("config-diff emits structured JSON and exits zero when every plane is in sync", async () => {
    const fixture = createCliFixture();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runner_groups: [
              { id: 7, name: "synology-private" },
              { id: 8, name: "linux-private" },
              { id: 9, name: "windows-private" },
              { id: 10, name: "macos-private" }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runners: [
              configDiffRunner(101, "synology-private-runner-01", 7, [
                "self-hosted",
                "synology",
                "shell-only",
                "private",
                "custom-label"
              ]),
              configDiffRunner(102, "linux-private-runner-01", 8, [
                "self-hosted",
                "linux",
                "docker-capable",
                "private",
                "docker-host"
              ]),
              configDiffRunner(103, "windows-private-runner-01", 9, [
                "self-hosted",
                "windows",
                "docker-capable",
                "private",
                "x64"
              ]),
              configDiffRunner(104, "macos-runner-slot-01", 10, [
                "self-hosted",
                "macos",
                "arm64",
                "private",
                "xcode"
              ])
            ]
          })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await invokeCli([
      "config-diff",
      "--env",
      fixture.envPath,
      "--config",
      fixture.synologyConfigPath,
      "--linux-config",
      fixture.linuxConfigPath,
      "--windows-config",
      fixture.windowsConfigPath,
      "--lume-config",
      fixture.lumeConfigPath,
      "--format",
      "json"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual({
      inSync: true,
      added: [],
      removed: [],
      changed: []
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("config-diff renders +/- text and exits non-zero for registration drift", async () => {
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
                { id: 7, name: "synology-private" },
                { id: 8, name: "wrong-group" }
              ]
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runners: [
                configDiffRunner(101, "synology-private-runner-01", 8, [
                  "self-hosted",
                  "synology",
                  "private",
                  "stale-label"
                ]),
                configDiffRunner(102, "synology-private-runner-old", 7, [
                  "self-hosted",
                  "synology",
                  "private"
                ])
              ]
            })
        })
    );

    const result = await invokeCli([
      "config-diff",
      "--env",
      fixture.envPath,
      "--plane",
      "synology",
      "--config",
      fixture.synologyConfigPath,
      "--format",
      "text"
    ]);

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("config-diff: out of sync");
    expect(result.stdout).toContain("- example/synology-private-runner-old");
    expect(result.stdout).toContain("~ example/synology-private-runner-01");
    expect(result.stdout).toContain("group wrong-group -> synology-private");
    expect(result.stdout).toContain("missing labels custom-label,shell-only");
    expect(result.stdout).toContain("unexpected labels stale-label");
  });

  test("prune-stale-runners defaults to dry-run JSON output", async () => {
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
                  id: 301,
                  name: "synology-private-runner-01",
                  status: "offline",
                  busy: false,
                  runner_group_id: 7
                },
                {
                  id: 302,
                  name: "synology-private-runner-old",
                  status: "offline",
                  busy: false,
                  runner_group_id: 7
                },
                {
                  id: 303,
                  name: "synology-private-runner-busy",
                  status: "offline",
                  busy: true,
                  runner_group_id: 7
                }
              ]
            })
        })
    );

    const result = await invokeCli([
      "prune-stale-runners",
      "--env",
      fixture.envPath,
      "--plane",
      "synology",
      "--config",
      fixture.synologyConfigPath,
      "--format",
      "json"
    ]);

    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual({
      apply: false,
      groups: [
        {
          plane: "synology",
          poolKey: "synology-private",
          organization: "example",
          runnerGroup: "synology-private",
          expected: ["synology-private-runner-01"],
          scanned: 3
        }
      ],
      stale: [
        {
          plane: "synology",
          poolKey: "synology-private",
          organization: "example",
          runnerGroup: "synology-private",
          id: 302,
          name: "synology-private-runner-old",
          status: "offline",
          busy: false
        }
      ],
      deleted: []
    });
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

function parseJsonLogLines(stderr: string): Array<Record<string, unknown>> {
  return stderr
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function configDiffRunner(
  id: number,
  name: string,
  runnerGroupId: number,
  labels: string[]
) {
  return {
    id,
    name,
    status: "online",
    runner_group_id: runnerGroupId,
    labels: labels.map((label) => ({ name: label }))
  };
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
