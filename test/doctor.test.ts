import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadDeploymentEnv } from "../src/lib/env.js";
import { formatDoctorText, runDoctor } from "../src/lib/doctor.js";
import type { FetchLike } from "../src/lib/github.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("doctor", () => {
  test("validates Synology mode with stable text and JSON-friendly results", async () => {
    const fixture = createFixture({ withPat: true });
    const report = await runDoctor({
      mode: "synology",
      env: fixture.env,
      synologyConfigPath: fixture.synologyConfigPath,
      lumeConfigPath: fixture.lumeConfigPath,
      fetchImpl: buildFetchMock()
    });

    expect(report.ok).toBe(true);
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0]).toMatchObject({
      key: "synology",
      ok: true
    });
    expect(formatDoctorText(report)).toContain("synology: ok");
    expect(report.sections[0]?.checks.map((check) => check.key)).toEqual([
      "config",
      "synology_host",
      "github_runner_groups",
      "image_tag"
    ]);
  });

  test("fails Synology mode clearly when GitHub credentials are missing", async () => {
    vi.stubEnv("GITHUB_PAT", "");
    const fixture = createFixture({ withPat: false });
    const report = await runDoctor({
      mode: "synology",
      env: fixture.env,
      synologyConfigPath: fixture.synologyConfigPath,
      lumeConfigPath: fixture.lumeConfigPath
    });

    expect(report.ok).toBe(false);
    expect(report.sections[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "github_runner_groups",
          ok: false,
          summary: expect.stringContaining("GITHUB_PAT is required")
        }),
        expect.objectContaining({
          key: "image_tag",
          ok: false,
          summary: expect.stringContaining("GITHUB_PAT is required")
        })
      ])
    );
  });

  test("validates Lume mode", async () => {
    const fixture = createFixture({ withPat: true });
    const report = await runDoctor({
      mode: "lume",
      env: fixture.env,
      synologyConfigPath: fixture.synologyConfigPath,
      lumeConfigPath: fixture.lumeConfigPath,
      fetchImpl: buildFetchMock()
    });

    expect(report.ok).toBe(true);
    expect(report.sections).toEqual([
      expect.objectContaining({ key: "lume", ok: true })
    ]);
    expect(report.sections[0]?.checks.map((check) => check.key)).toEqual([
      "config",
      "lume_env_file",
      "github_runner_group"
    ]);
  });

  test("fails Lume mode clearly when GitHub credentials are missing", async () => {
    vi.stubEnv("GITHUB_PAT", "");
    const fixture = createFixture({ withPat: false });
    const report = await runDoctor({
      mode: "lume",
      env: fixture.env,
      synologyConfigPath: fixture.synologyConfigPath,
      lumeConfigPath: fixture.lumeConfigPath
    });

    expect(report.ok).toBe(false);
    expect(report.sections[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "github_runner_group",
          ok: false,
          summary: expect.stringContaining("GITHUB_PAT is required")
        })
      ])
    );
  });

  test("runs the full fleet doctor mode", async () => {
    const fixture = createFixture({ withPat: true });
    const report = await runDoctor({
      mode: "all",
      env: fixture.env,
      synologyConfigPath: fixture.synologyConfigPath,
      lumeConfigPath: fixture.lumeConfigPath,
      fetchImpl: buildFetchMock()
    });

    expect(report.ok).toBe(true);
    expect(report.sections.map((section) => section.key)).toEqual([
      "shared",
      "synology",
      "lume"
    ]);
    expect(report.sections[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "github_pat", ok: true }),
        expect.objectContaining({ key: "runner_release", ok: true })
      ])
    );
  });
});

function createFixture(options: { withPat: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));
  tempDirs.push(dir);

  const envPath = path.join(dir, ".env");
  const synologyConfigPath = path.join(dir, "pools.yaml");
  const lumeConfigPath = path.join(dir, "lume-runners.yaml");
  const lumeBaseDir = path.join(dir, "lume");
  const lumeEnvFile = path.join(lumeBaseDir, "runner.env");

  fs.mkdirSync(lumeBaseDir, { recursive: true });
  fs.writeFileSync(lumeEnvFile, "RUNNER_TOKEN=dummy\n", "utf8");
  fs.writeFileSync(
    envPath,
    [
      `GITHUB_API_URL=https://api.github.test`,
      options.withPat ? `GITHUB_PAT=test-token` : "",
      `SYNOLOGY_HOST=nas.example.test`,
      `SYNOLOGY_USERNAME=admin`,
      `SYNOLOGY_PASSWORD=secret`,
      `SYNOLOGY_RUNNER_BASE_DIR=${path.join(dir, "synology-runners")}`,
      `LUME_RUNNER_BASE_DIR=${lumeBaseDir}`,
      `LUME_RUNNER_ENV_FILE=${lumeEnvFile}`
    ]
      .filter(Boolean)
      .join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    synologyConfigPath,
    `version: 1
image:
  repository: ghcr.io/omt-global/github-runner-fleet
  tag: 0.1.9
pools:
  - key: synology-private
    visibility: private
    organization: omt-global
    runnerGroup: synology-private
    repositoryAccess: selected
    allowedRepositories:
      - omt-global/example
    labels: []
    size: 2
    architecture: auto
    runnerRoot: ${JSON.stringify(path.join(dir, "synology-runners", "private"))}
`,
    "utf8"
  );
  fs.writeFileSync(
    lumeConfigPath,
    `version: 1
pool:
  key: macos-private
  organization: omt-global
  runnerGroup: macos-private
  size: 2
  vmBaseName: macos-runner-base
  vmSlotPrefix: macos-runner
`,
    "utf8"
  );

  return {
    env: loadDeploymentEnv({ envPath, requirePat: false }),
    synologyConfigPath,
    lumeConfigPath
  };
}

function buildFetchMock(): FetchLike {
  return async (input) => {
    if (input.endsWith("/repos/actions/runner/releases/latest")) {
      return response(200, {
        tag_name: "v2.333.0",
        published_at: "2026-04-01T00:00:00Z",
        html_url: "https://github.test/actions/runner/releases/v2.333.0"
      });
    }

    if (input.includes("/actions/runner-groups")) {
      if (input.includes("/orgs/omt-global/")) {
        return response(200, {
          runner_groups: [
            { id: 1, name: "synology-private", visibility: "selected", default: false },
            { id: 2, name: "macos-private", visibility: "selected", default: false }
          ]
        });
      }
    }

    if (input.includes("/packages/container/github-runner-fleet/versions")) {
      return response(200, [
        {
          id: 42,
          updated_at: "2026-04-01T00:00:00Z",
          metadata: {
            container: {
              tags: ["0.1.9"]
            }
          }
        }
      ]);
    }

    throw new Error(`unexpected fetch call: ${input}`);
  };
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}
