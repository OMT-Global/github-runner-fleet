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
LINUX_DOCKER_HOST=docker-host.example.com
LINUX_DOCKER_USERNAME=runner
LINUX_DOCKER_PROJECT_DIR=${directory}/linux-docker
LINUX_DOCKER_RUNNER_BASE_DIR=${directory}/linux-docker
WINDOWS_DOCKER_HOST=windows-host.example.com
WINDOWS_DOCKER_USERNAME=administrator
WINDOWS_DOCKER_RUNNER_BASE_DIR=C:\\github-runner-fleet\\windows-docker
LUME_RUNNER_BASE_DIR=${directory}/lume
LUME_RUNNER_ENV_FILE=${lumeRunnerEnvPath}
LUME_GUEST_PASSWORD=secret
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

    const linuxConfigPath = path.join(directory, "linux-docker-runners.yaml");
    fs.writeFileSync(
      linuxConfigPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
  - key: linux-docker-private
    organization: example
    runnerGroup: linux-docker-private
    repositoryAccess: selected
    allowedRepositories:
      - example/private-app
    labels: []
    size: 1
    architecture: amd64
    runnerRoot: \${LINUX_DOCKER_RUNNER_BASE_DIR}/pools/linux-docker-private
`,
      "utf8"
    );

    const windowsConfigPath = path.join(directory, "windows-runners.yaml");
    fs.writeFileSync(
      windowsConfigPath,
      `version: 1
plane: windows-docker
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9-windows
pools:
  - key: windows-private
    organization: example
    runnerGroup: windows-private
    repositoryAccess: selected
    allowedRepositories:
      - example/windows-app
    host: windows-host.example.com
    sshUser: administrator
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
                  name: "windows-private",
                  visibility: "selected",
                  default: false
                },
                {
                  id: 4,
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
      linuxConfigPath,
      windowsConfigPath,
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
          id: "windows-docker-runner-groups",
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
LINUX_DOCKER_ALLOW_ALL_REPOSITORIES=true
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

  test("fails Windows Docker doctor when required env is missing and skips GitHub checks without a PAT", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `WINDOWS_DOCKER_RUNNER_BASE_DIR=C:\\github-runner-fleet\\windows-docker
`,
      "utf8"
    );

    const windowsConfigPath = path.join(directory, "windows-runners.yaml");
    fs.writeFileSync(
      windowsConfigPath,
      `version: 1
plane: windows-docker
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9-windows
pools:
  - key: windows-private
    organization: example
    runnerGroup: windows-private
    repositoryAccess: selected
    allowedRepositories:
      - example/windows-app
    host: windows-host.example.com
    sshUser: administrator
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
          mode: "windows-docker",
          envPath,
          windowsConfigPath
        })
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "windows-docker-env",
          status: "fail"
        }),
        expect.objectContaining({
          id: "windows-docker-config",
          status: "pass"
        }),
        expect.objectContaining({
          id: "windows-docker-runner-groups",
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
LUME_GUEST_PASSWORD=secret
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
LUME_GUEST_PASSWORD=secret
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
LUME_GUEST_PASSWORD=secret
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
LUME_GUEST_PASSWORD=secret
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

function findCheck(
  report: { checks: Array<{ id: string }> },
  id: string
) {
  const check = report.checks.find((entry) => entry.id === id);
  if (!check) {
    throw new Error(`expected a doctor check with id ${id}`);
  }
  return check as {
    id: string;
    status: string;
    summary: string;
    detail?: string;
    data?: unknown;
  };
}

describe("doctor summary, detail, and observability mutation coverage", () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.METRICS_ENDPOINT;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEndpoint === undefined) {
      delete process.env.METRICS_ENDPOINT;
    } else {
      process.env.METRICS_ENDPOINT = originalEndpoint;
    }
  });

  function writeSynologyScaffold(
    directory: string,
    options: { pools: Array<{ key: string; size: number }>; pat?: boolean }
  ) {
    const envPath = path.join(directory, ".env");
    const auditLogPath = path.join(directory, "audit.jsonl");
    fs.writeFileSync(auditLogPath, "audit-entry\n", "utf8");
    fs.writeFileSync(
      envPath,
      [
        options.pat === false ? "" : "GITHUB_PAT=secret",
        "SYNOLOGY_HOST=nas.example.com",
        "SYNOLOGY_USERNAME=admin",
        "SYNOLOGY_PASSWORD=secret",
        `SYNOLOGY_RUNNER_BASE_DIR=${directory}/synology`,
        `AUDIT_LOG_FILE=${auditLogPath}`,
        ""
      ].join("\n"),
      "utf8"
    );

    const poolsPath = path.join(directory, "pools.yaml");
    const poolBlocks = options.pools
      .map(
        (pool) => `  - key: ${pool.key}
    visibility: private
    organization: example
    runnerGroup: ${pool.key}
    repositoryAccess: all
    labels: []
    size: ${pool.size}
    architecture: auto
    runnerRoot: \${SYNOLOGY_RUNNER_BASE_DIR}/pools/${pool.key}`
      )
      .join("\n");
    fs.writeFileSync(
      poolsPath,
      `version: 1
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9
pools:
${poolBlocks}
`,
      "utf8"
    );

    return { envPath, poolsPath, auditLogPath };
  }

  test("emits exact summaries, details, pluralization, and pool metrics", async () => {
    const directory = createTempDir();
    const { envPath, poolsPath } = writeSynologyScaffold(directory, {
      pools: [
        { key: "synology-private", size: 1 },
        { key: "synology-public", size: 3 }
      ]
    });

    const metricsFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = metricsFetch as unknown as typeof fetch;
    process.env.METRICS_ENDPOINT = "https://metrics.example.com/push";

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [
                { id: 1, name: "synology-private", default: false },
                { id: 2, name: "synology-public", default: false }
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
              { id: 9, metadata: { container: { tags: ["0.1.9"] } } }
            ])
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

    expect(findCheck(report, "synology-env").summary).toBe(
      "required Synology deployment env is configured"
    );
    expect(findCheck(report, "synology-config").summary).toBe(
      `loaded ${poolsPath} with 2 pools`
    );
    expect(findCheck(report, "synology-config-warnings").summary).toBe(
      "no Synology config warnings were detected"
    );
    expect(findCheck(report, "synology-runner-groups")).toMatchObject({
      status: "pass",
      summary: "verified 2 Synology runner groups in GitHub"
    });
    expect(findCheck(report, "synology-image").summary).toBe(
      "verified ghcr.io/example/github-runner-fleet:0.1.9 in GitHub Packages"
    );
    expect(findCheck(report, "audit-log").detail).toBe("size 12 bytes");
    expect(findCheck(report, "audit-log").data).toMatchObject({
      sizeBytes: 12
    });

    const metricsBody = metricsFetch.mock.calls
      .map((call) => (call[1] as { body: string }).body)
      .join("");
    expect(metricsBody).toContain(
      'pool_slot_count{plane="synology",pool="synology-private"} 1'
    );
    expect(metricsBody).toContain(
      'pool_slot_count{plane="synology",pool="synology-public"} 3'
    );
    expect(metricsBody).toContain(
      'doctor_check_result{check="synology-env",status="pass"} 1'
    );

    const stderrWrite = vi.mocked(process.stderr.write);
    const envLog = stderrWrite.mock.calls
      .map((call) => JSON.parse(String(call[0])) as { check: string; level: string })
      .find((entry) => entry.check === "synology-env");
    expect(envLog?.level).toBe("info");
  });

  test("uses singular nouns and exact failure detail when env and PAT are missing", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `SYNOLOGY_USERNAME=admin
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
        GH_TOKEN: undefined,
        SYNOLOGY_HOST: undefined
      },
      () =>
        runDoctor({
          mode: "synology",
          envPath,
          configPath: poolsPath
        })
    );

    const envCheck = findCheck(report, "synology-env");
    expect(envCheck.status).toBe("fail");
    expect(envCheck.summary).toBe(
      "required Synology deployment env is incomplete"
    );
    expect(envCheck.detail).toBe("missing GITHUB_PAT, SYNOLOGY_HOST");
    expect(findCheck(report, "synology-config").summary).toBe(
      `loaded ${poolsPath} with 1 pool`
    );
    expect(findCheck(report, "synology-runner-groups")).toMatchObject({
      status: "skip",
      summary: "skipped Synology runner-group verification",
      detail: "GITHUB_PAT is not configured"
    });
    expect(findCheck(report, "synology-image").detail).toBe(
      "GITHUB_PAT is not configured"
    );
    expect(report.ok).toBe(false);

    const stderrWrite = vi.mocked(process.stderr.write);
    const failLog = stderrWrite.mock.calls
      .map((call) => JSON.parse(String(call[0])) as { check: string; level: string })
      .find((entry) => entry.check === "synology-env");
    expect(failLog?.level).toBe("error");
  });

  test("surfaces the runner-group verification failure detail", async () => {
    const directory = createTempDir();
    const { envPath, poolsPath } = writeSynologyScaffold(directory, {
      pools: [{ key: "synology-private", size: 1 }]
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/actions/runner-groups")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              runner_groups: [{ id: 1, name: "default", default: true }]
            })
        };
      }
      if (url.includes("/packages/container/")) {
        return { ok: false, status: 404, text: async () => "Not Found" };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const report = await runDoctor({
      mode: "synology",
      envPath,
      configPath: poolsPath,
      fetchImpl: fetchMock
    });

    const groupCheck = findCheck(report, "synology-runner-groups");
    expect(groupCheck.status).toBe("fail");
    expect(groupCheck.summary).toBe("failed Synology runner-group verification");
    expect(groupCheck.detail).toContain(
      "pool synology-private expects runner group synology-private in organization example, but GitHub returned: default"
    );

    const imageCheck = findCheck(report, "synology-image");
    expect(imageCheck.status).toBe("fail");
    expect(imageCheck.summary).toBe(
      "failed image verification for ghcr.io/example/github-runner-fleet:0.1.9"
    );
  });

  test("warns with exact detail for missing Lume artifacts and unhealthy results", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    const lumeBaseDir = path.join(directory, "lume");
    fs.mkdirSync(lumeBaseDir, { recursive: true });
    const lumeRunnerEnvPath = path.join(lumeBaseDir, "runner.env");
    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
LUME_RUNNER_BASE_DIR=${lumeBaseDir}
LUME_RUNNER_ENV_FILE=${lumeRunnerEnvPath}
LUME_GUEST_PASSWORD=secret
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
              runner_groups: [{ id: 1, name: "macos-private", default: false }]
            })
        };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const missingResult = await runDoctor({
      mode: "lume",
      envPath,
      lumeConfigPath: lumePath,
      fetchImpl: fetchMock
    });
    const envFileCheck = findCheck(missingResult, "lume-env-file");
    expect(envFileCheck.status).toBe("warn");
    expect(envFileCheck.summary).toBe("Lume runner env file is missing");
    expect(envFileCheck.detail).toBe(
      `${lumeRunnerEnvPath} does not exist yet`
    );
    const artifactCheck = findCheck(missingResult, "lume-project-result");
    expect(artifactCheck.status).toBe("warn");
    expect(artifactCheck.summary).toBe(
      "Lume project result artifact is missing"
    );
    expect(artifactCheck.detail).toBe(
      `run install-lume-project to create ${path.join(
        lumeBaseDir,
        "lume-project-result.json"
      )}`
    );

    fs.writeFileSync(
      path.join(lumeBaseDir, "lume-project-result.json"),
      `${JSON.stringify({
        plane: "lume",
        action: "install",
        status: "failed",
        recordedAt: "2026-04-21T00:00:00.000Z",
        configPath: lumePath,
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

    const unhealthy = await runDoctor({
      mode: "lume",
      envPath,
      lumeConfigPath: lumePath,
      fetchImpl: fetchMock
    });
    const unhealthyCheck = findCheck(unhealthy, "lume-project-result");
    expect(unhealthyCheck.status).toBe("warn");
    expect(unhealthyCheck.summary).toBe(
      "latest Lume project result action=install status=failed"
    );
  });

  test("reports missing Windows Docker host fields with an exact detail", async () => {
    const directory = createTempDir();
    const envPath = path.join(directory, ".env");
    fs.writeFileSync(
      envPath,
      `GITHUB_PAT=secret
WINDOWS_DOCKER_RUNNER_BASE_DIR=C:\\github-runner-fleet\\windows-docker
`,
      "utf8"
    );
    const windowsPath = path.join(directory, "windows-runners.yaml");
    fs.writeFileSync(
      windowsPath,
      `version: 1
plane: windows-docker
image:
  repository: ghcr.io/example/github-runner-fleet
  tag: 0.1.9-windows
pools:
  - key: windows-private
    organization: example
    runnerGroup: windows-private
    repositoryAccess: selected
    allowedRepositories:
      - example/windows-app
`,
      "utf8"
    );

    const report = await withEnv(
      {
        GITHUB_PAT: undefined,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
        WINDOWS_DOCKER_HOST: undefined,
        WINDOWS_DOCKER_USERNAME: undefined
      },
      () =>
        runDoctor({
          mode: "windows-docker",
          envPath,
          windowsConfigPath: windowsPath,
          fetchImpl: vi.fn(async () => {
            throw new Error("runner-group verification should not run");
          })
        })
    );

    const configCheck = findCheck(report, "windows-docker-config");
    expect(configCheck.status).toBe("fail");
    expect(configCheck.summary).toBe(
      "Windows Docker config is missing target host fields"
    );
    expect(configCheck.detail).toBe(
      "missing windows-private:host, windows-private:sshUser"
    );
  });
});
