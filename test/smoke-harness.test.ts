import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

function makeTempRoot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runner-smoke-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

async function waitForReady(logPath: string, port: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      fs.existsSync(logPath) &&
      fs.readFileSync(logPath, "utf8").includes(`listening 0.0.0.0:${port}`)
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("mock API did not become ready");
}

describe("runner registration smoke harness", () => {
  test("serves deterministic registration and cleanup tokens", async () => {
    const tempRoot = makeTempRoot();
    const logPath = path.join(tempRoot, "mock-api.log");
    const port = 18080 + Number(process.env.VITEST_POOL_ID ?? "0");
    const server = spawn("node", ["scripts/smoke/mock-api.mjs"], {
      env: {
        ...process.env,
        MOCK_LOG_PATH: logPath,
        MOCK_PORT: String(port),
      },
      stdio: "ignore",
    });

    try {
      await waitForReady(logPath, port);

      await expect(
        fetch(
          `http://127.0.0.1:${port}/orgs/test-org/actions/runners/registration-token`,
          { method: "POST" }
        ).then((response) => response.json())
      ).resolves.toEqual({ token: "registration-token" });

      await expect(
        fetch(
          `http://127.0.0.1:${port}/orgs/test-org/actions/runners/remove-token`,
          { method: "POST" }
        ).then((response) => response.json())
      ).resolves.toEqual({ token: "remove-token" });

      const log = fs.readFileSync(logPath, "utf8");
      expect(log).toContain(
        "POST /orgs/test-org/actions/runners/registration-token"
      );
      expect(log).toContain("POST /orgs/test-org/actions/runners/remove-token");
    } finally {
      server.kill();
    }
  });

  test("records runner config and execution state without a live runner bundle", () => {
    const tempRoot = makeTempRoot();
    const runnerHome = path.join(tempRoot, "runner-home");
    const workDir = path.join(tempRoot, "_work");
    fs.mkdirSync(runnerHome, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    const env = {
      ...process.env,
      RUNNER_EXECUTION_MODE: "runner",
      RUNNER_STATE_DIR: tempRoot,
      RUNNER_WORK_DIR: workDir,
    };

    const configResult = spawnSync(
      "bash",
      [
        path.resolve("scripts/smoke/actions-runner/config.sh"),
        "--unattended",
        "--token",
        "registration-token",
        "--runnergroup",
        "synology-private",
        "--ephemeral",
        "--disableupdate",
      ],
      { cwd: runnerHome, encoding: "utf8", env }
    );
    expect(configResult.status).toBe(0);

    const runResult = spawnSync(
      "bash",
      [path.resolve("scripts/smoke/actions-runner/run.sh")],
      { cwd: runnerHome, encoding: "utf8", env }
    );
    expect(runResult.status).toBe(0);
    expect(runResult.stdout.trim()).toBe("job output");

    const removeResult = spawnSync(
      "bash",
      [
        path.resolve("scripts/smoke/actions-runner/config.sh"),
        "remove",
        "--token",
        "remove-token",
      ],
      { cwd: runnerHome, encoding: "utf8", env }
    );
    expect(removeResult.status).toBe(0);

    expect(fs.readFileSync(path.join(tempRoot, "config-invocations.log"), "utf8"))
      .toContain("--token registration-token");
    expect(fs.readFileSync(path.join(tempRoot, "config-invocations.log"), "utf8"))
      .toContain("remove --token remove-token");
    expect(fs.readFileSync(path.join(tempRoot, "config-context.log"), "utf8"))
      .toContain("config path: " + runnerHome);
    expect(fs.readFileSync(path.join(tempRoot, "run-context.log"), "utf8"))
      .toContain("run mode: runner");
    expect(fs.existsSync(path.join(runnerHome, ".runner"))).toBe(true);
    expect(fs.existsSync(path.join(workDir, "workspace", "job.txt"))).toBe(true);
  });

  test("wires the smoke script to run both execution modes and verify cleanup", () => {
    const script = fs.readFileSync(
      path.resolve("scripts/smoke-test.sh"),
      "utf8"
    );

    expect(script).toContain("run_smoke_case runner");
    expect(script).toContain("run_smoke_case root");
    expect(script).toContain("grep -q -- \"remove --token remove-token\"");
    expect(script).toContain(
      "grep -q \"runner registration removed cleanly\""
    );
    expect(script).toContain("verify_python_toolcache");
    expect(script).toContain("verify_docker_cli");
  });
});
