import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderDoctorReport, runDoctor } from "../src/lib/doctor.js";

const tempPaths: string[] = [];

beforeEach(() => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

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
  vi.restoreAllMocks();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("doctor", () => {
  test("produces a passing full report when Synology and Lume checks succeed", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    const lumeRunnerEnvPath = path.join(directory, "lume", "runner.env");
    fs.mkdirSync(path.dirname(lumeRunnerEnvPath), { recursive: true });
    fs.writeFileSync(lumeRunnerEnvPath, "GITHUB_PAT=secret\n", "utf8");

    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
SYNOLOGY_HOST=nas.example.com
SYNOLOGY_USERNAME=admin
SYNOLOGY_PASSWORD=secret
SYNOLOGY_RUNNER_BASE_DIR=${directory}/synology
LINUX_DOCKER_HOST=docker.example.com
LINUX_DOCKER_USERNAME=runner
LINUX_DOCKER_PROJECT_DIR=${directory}/linux-docker
LINUX_DOCKER_RUNNER_BASE_DIR=${directory}/linux-docker
LUME_RUNNER_BASE_DIR=${directory}/lume
LUME_RUNNER_ENV_FILE=${lumeRunnerEnvPath}
`,
      "utf8"
    );

    const poolsPath = path.join(directory, "pools.yaml");
    fs.writeFileSync(
      poolsPath,
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
    labels: []
    size: 1
    architecture: auto
    runnerRoot: \${SYNOLOGY_RUNNER_BASE_DIR}/pools/synology-private
`,
      "utf8"
    );

    const linuxDockerPath = path.join(directory, "linux-docker-runners.yaml");
    fs.writeFileSync(
      linuxDockerPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-private
    organization: example
    runnerGroup: linux-docker-private
    repositoryAccess: all
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: \${LINUX_DOCKER_RUNNER_BASE_DIR}/pools/linux-docker-private
`,
      "utf8"
    );

    const lumePath = path.join(directory, "lume-runners.yaml");
    fs.writeFileSync(
      lumePath,
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

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                {
                  id: 1,
                  name: "synology-private",
                  visibility: "all",
                  default: false
                },
                {
                  id: 2,
                  name: "linux-docker-private",
                  visibility: "selected",
                  default: false
                },
                {
                  id: 3,
                  name: "macos-private",
                  visibility: "selected",
                  default: false
                }
              ]
            })
        };
      }

      if (url.includes("/packages/container/")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify([
              {
                id: 101,
                updated_at: "2026-04-12T00:00:00Z",
                metadata: {
                  container: {
                    tags: ["0.1.9", "latest"]
                  }
                }
              }
            ])
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    const report = await runDoctor({
      mode: "full",
      envPath,
      configPath: poolsPath,
      linuxDockerConfigPath: linuxDockerPath,
      lumeConfigPath: lumePath,
      fetchImpl: fetchMock
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synology-runner-groups",
          status: "pass"
        }),
        expect.objectContaining({
          id: "synology-image",
          status: "pass"
        }),
        expect.objectContaining({
          id: "linux-docker-runner-groups",
          status: "pass"
        }),
        expect.objectContaining({
          id: "linux-docker-image",
          status: "pass"
        }),
        expect.objectContaining({
          id: "lume-runner-group",
          status: "pass"
        })
      ])
    );
    const stderrWrite = vi.mocked(process.stderr.write);
    const synologyEnvLog = stderrWrite.mock.calls
      .map((call) => JSON.parse(String(call[0])) as {
        level: string;
        msg: string;
        plane: string;
        pool: string;
        check: string;
        status: string;
      })
      .find((entry) => entry.check === "synology-env");
    expect(synologyEnvLog).toEqual(
      expect.objectContaining({
        level: "info",
        msg: "doctor check result",
        plane: "synology",
        pool: "n/a",
        check: "synology-env",
        status: "pass"
      })
    );

    const auditLog = stderrWrite.mock.calls
      .map((call) => JSON.parse(String(call[0])) as {
        check: string;
        summary: string;
      })
      .find((entry) => entry.check === "audit-log");
    expect(auditLog?.summary).toContain("audit log path");

    const firstLog = JSON.parse(String(stderrWrite.mock.calls[0][0])) as {
      level: string;
      msg: string;
      plane: string;
      pool: string;
      check: string;
      status: string;
    };
    expect(firstLog).toEqual(
      expect.objectContaining({
        level: "info",
        msg: "doctor check result",
        plane: "synology",
        pool: "n/a",
        check: "audit-log",
        status: "pass"
      })
    );

    const rendered = renderDoctorReport(report);
    expect(rendered).toContain("doctor mode: full");
    expect(rendered).toContain("PASS audit-log: audit log path");
    expect(rendered).toContain("PASS synology-image");
    expect(rendered).toContain("PASS linux-docker-image");
    expect(rendered).toContain("overall: PASS");
  });

  test("fails Synology doctor when required env is missing and skips GitHub checks without a PAT", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `SYNOLOGY_HOST=nas.example.com
SYNOLOGY_USERNAME=admin
SYNOLOGY_PASSWORD=secret
SYNOLOGY_RUNNER_BASE_DIR=${directory}/synology
`,
      "utf8"
    );

    const poolsPath = path.join(directory, "pools.yaml");
    fs.writeFileSync(
      poolsPath,
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
    labels: []
    size: 1
    architecture: auto
    runnerRoot: \${SYNOLOGY_RUNNER_BASE_DIR}/pools/synology-private
`,
      "utf8"
    );

    const report = await withEnv(
      {
        GITHUB_PAT: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined
      },
      () =>
        runDoctor({
          mode: "synology",
          envPath,
          configPath: poolsPath
        })
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synology-env",
          status: "fail"
        }),
        expect.objectContaining({
          id: "synology-runner-groups",
          status: "skip"
        }),
        expect.objectContaining({
          id: "synology-image",
          status: "skip"
        })
      ])
    );

    const rendered = renderDoctorReport(report);
    expect(rendered).toContain("FAIL synology-env");
    expect(rendered).toContain("missing GITHUB_PAT");
    expect(rendered).toContain("SKIP synology-image");
    expect(rendered).toContain("overall: FAIL");
  });

  test("reports Synology config warnings and GitHub verification failures", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
SYNOLOGY_HOST=nas.example.com
SYNOLOGY_USERNAME=admin
SYNOLOGY_PASSWORD=secret
SYNOLOGY_RUNNER_BASE_DIR=${directory}/synology
`,
      "utf8"
    );

    const poolsPath = path.join(directory, "pools.yaml");
    fs.writeFileSync(
      poolsPath,
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
    labels: []
    size: 1
    architecture: auto
    runnerRoot: \${SYNOLOGY_RUNNER_BASE_DIR}/pools/synology-private
    resources:
      cpus: "1"
`,
      "utf8"
    );

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: []
            })
        };
      }

      if (url.includes("/packages/container/")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([])
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    const report = await runDoctor({
      mode: "synology",
      envPath,
      configPath: poolsPath,
      fetchImpl: fetchMock
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synology-config-warnings",
          status: "warn",
          summary: "1 Synology config warning detected",
          detail: "pool synology-private sets resources.cpus=1; Synology kernels often reject Docker NanoCPUs/CPU CFS limits, so prefer omitting cpus unless you have verified support on your NAS"
        }),
        expect.objectContaining({
          id: "synology-runner-groups",
          status: "fail",
          summary: "failed Synology runner-group verification",
          detail:
            "pool synology-private expects runner group synology-private in organization example, but GitHub returned: none"
        }),
        expect.objectContaining({
          id: "synology-image",
          status: "fail",
          summary:
            "failed image verification for ghcr.io/example/github-runner-fleet:0.1.9",
          detail:
            "GitHub container package example/github-runner-fleet does not include tag 0.1.9; available tags: none"
        })
      ])
    );
  });

  test("stops Synology doctor when config cannot be loaded", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
SYNOLOGY_HOST=nas.example.com
SYNOLOGY_USERNAME=admin
SYNOLOGY_PASSWORD=secret
SYNOLOGY_RUNNER_BASE_DIR=${directory}/synology
`,
      "utf8"
    );

    const poolsPath = path.join(directory, "pools.yaml");
    fs.writeFileSync(
      poolsPath,
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
    labels: []
    size: 1
    architecture: auto
    runnerRoot: relative/path
`,
      "utf8"
    );

    const report = await runDoctor({
      mode: "synology",
      envPath,
      configPath: poolsPath
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synology-env",
          status: "pass"
        }),
        expect.objectContaining({
          id: "synology-config",
          status: "fail",
          summary: `failed to load ${poolsPath}`,
          detail: "pool synology-private runnerRoot must resolve to an absolute path"
        })
      ])
    );
  });

  test("fails Linux Docker doctor when required env is missing and skips GitHub checks without a PAT", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `LINUX_DOCKER_PROJECT_DIR=${directory}/linux-docker
LINUX_DOCKER_RUNNER_BASE_DIR=${directory}/linux-docker
`,
      "utf8"
    );

    const linuxDockerPath = path.join(directory, "linux-docker-runners.yaml");
    fs.writeFileSync(
      linuxDockerPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-private
    organization: example
    runnerGroup: linux-docker-private
    repositoryAccess: all
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: \${LINUX_DOCKER_RUNNER_BASE_DIR}/pools/linux-docker-private
`,
      "utf8"
    );

    const report = await withEnv(
      {
        GITHUB_PAT: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined
      },
      () =>
        runDoctor({
          mode: "linux-docker",
          envPath,
          linuxDockerConfigPath: linuxDockerPath
        })
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "linux-docker-env",
          status: "fail"
        }),
        expect.objectContaining({
          id: "linux-docker-runner-groups",
          status: "skip"
        }),
        expect.objectContaining({
          id: "linux-docker-image",
          status: "skip"
        })
      ])
    );
  });

  test("warns in Lume mode when the runner env file is missing", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    const lumeRunnerEnvPath = path.join(directory, "missing", "runner.env");

    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
LUME_RUNNER_BASE_DIR=${directory}/lume
LUME_RUNNER_ENV_FILE=${lumeRunnerEnvPath}
`,
      "utf8"
    );

    const lumePath = path.join(directory, "lume-runners.yaml");
    fs.writeFileSync(
      lumePath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  size: 1
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                {
                  id: 2,
                  name: "macos-private",
                  visibility: "selected",
                  default: false
                }
              ]
            })
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    const report = await runDoctor({
      mode: "lume",
      envPath,
      lumeConfigPath: lumePath,
      fetchImpl: fetchMock
    });

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lume-env-file",
          status: "warn"
        }),
        expect.objectContaining({
          id: "lume-project-result",
          status: "warn"
        }),
        expect.objectContaining({
          id: "lume-runner-group",
          status: "pass"
        })
      ])
    );
  });

  test("reports Lume pool health from the project result artifact", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    const lumeBaseDir = path.join(directory, "lume");
    const lumeRunnerEnvPath = path.join(lumeBaseDir, "runner.env");
    fs.mkdirSync(lumeBaseDir, { recursive: true });
    fs.writeFileSync(lumeRunnerEnvPath, "GITHUB_PAT=secret\n", "utf8");
    fs.writeFileSync(
      path.join(lumeBaseDir, "lume-project-result.json"),
      `${JSON.stringify({
        plane: "lume",
        action: "install",
        status: "started",
        recordedAt: "2026-04-21T00:00:00.000Z",
        configPath: path.join(directory, "lume-runners.yaml"),
        resultPath: path.join(lumeBaseDir, "lume-project-result.json"),
        pidFile: path.join(lumeBaseDir, "lume-project.pid"),
        logFile: path.join(lumeBaseDir, "logs", "lume-project.log"),
        pool: {
          key: "macos-private",
          organization: "example",
          runnerGroup: "macos-private",
          size: 1
        },
        slots: []
      })}\n`,
      "utf8"
    );
    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
LUME_RUNNER_BASE_DIR=${lumeBaseDir}
LUME_RUNNER_ENV_FILE=${lumeRunnerEnvPath}
`,
      "utf8"
    );

    const lumePath = path.join(directory, "lume-runners.yaml");
    fs.writeFileSync(
      lumePath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  size: 1
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                {
                  id: 2,
                  name: "macos-private",
                  visibility: "selected",
                  default: false
                }
              ]
            })
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    const report = await runDoctor({
      mode: "lume",
      envPath,
      lumeConfigPath: lumePath,
      fetchImpl: fetchMock
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lume-project-result",
          status: "pass",
          summary: "latest Lume project result action=install status=started"
        })
      ])
    );
  });

  test("skips Lume GitHub verification when no PAT is configured", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    const lumeRunnerEnvPath = path.join(directory, "lume", "runner.env");
    fs.mkdirSync(path.dirname(lumeRunnerEnvPath), { recursive: true });
    fs.writeFileSync(lumeRunnerEnvPath, "GITHUB_PAT=secret\n", "utf8");
    fs.writeFileSync(
      envPath,
      `LUME_RUNNER_BASE_DIR=${directory}/lume
LUME_RUNNER_ENV_FILE=${lumeRunnerEnvPath}
`,
      "utf8"
    );

    const lumePath = path.join(directory, "lume-runners.yaml");
    fs.writeFileSync(
      lumePath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  size: 1
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const report = await withEnv(
      {
        GITHUB_PAT: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined
      },
      () =>
        runDoctor({
          mode: "lume",
          envPath,
          lumeConfigPath: lumePath
        })
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lume-env",
          status: "fail",
          detail: "missing GITHUB_PAT"
        }),
        expect.objectContaining({
          id: "lume-env-file",
          status: "pass",
          summary: `found Lume runner env file at ${lumeRunnerEnvPath}`
        }),
        expect.objectContaining({
          id: "lume-runner-group",
          status: "skip",
          detail: "GITHUB_PAT is not configured"
        })
      ])
    );
  });

  test("reports Lume config and runner-group verification failures", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
LUME_RUNNER_BASE_DIR=${directory}/lume
`,
      "utf8"
    );

    const invalidLumePath = path.join(directory, "invalid-lume-runners.yaml");
    fs.writeFileSync(
      invalidLumePath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  size: 0
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const invalidReport = await runDoctor({
      mode: "lume",
      envPath,
      lumeConfigPath: invalidLumePath
    });

    expect(invalidReport.ok).toBe(false);
    expect(invalidReport.checks).toEqual([
      expect.objectContaining({
        id: "lume-env",
        status: "pass"
      }),
      expect.objectContaining({
        id: "lume-config",
        status: "fail",
        summary: `failed to load ${invalidLumePath}`
      })
    ]);

    const lumePath = path.join(directory, "lume-runners.yaml");
    fs.writeFileSync(
      lumePath,
      `version: 1
pool:
  key: macos-private
  organization: example
  runnerGroup: macos-private
  size: 1
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner-slot
`,
      "utf8"
    );

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: false,
          status: 403,
          text: async () => "forbidden"
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    const failedGitHubReport = await runDoctor({
      mode: "lume",
      envPath,
      lumeConfigPath: lumePath,
      fetchImpl: fetchMock
    });

    expect(failedGitHubReport.ok).toBe(false);
    expect(failedGitHubReport.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lume-env-file",
          status: "warn",
          detail: `${path.join(directory, "lume", "runner.env")} does not exist yet`
        }),
        expect.objectContaining({
          id: "lume-runner-group",
          status: "fail",
          summary: "failed Lume runner-group verification for macos-private",
          detail:
            "GitHub runner group lookup failed for example with 403: forbidden"
        })
      ])
    );
  });
});

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-"));
  tempPaths.push(directory);
  return directory;
}
