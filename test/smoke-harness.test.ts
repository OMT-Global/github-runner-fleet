import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

// Resolve as soon as the mock API prints its readiness sentinel on
// stdout. This is event-driven (no fixed-interval polling), and rejects
// immediately if the child fails to spawn or exits early, so the only
// way to hit `timeoutMs` is a genuine startup hang.
function waitForReady(
  server: ChildProcess,
  host: string,
  port: number,
  timeoutMs = 15000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      server.stdout?.off("data", onData);
      server.off("error", onError);
      server.off("exit", onExit);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes(`ready ${host}:${port}`)) {
        settle(resolve);
      }
    };
    const onError = (error: Error) => {
      settle(() => reject(error));
    };
    const onExit = (code: number | null) => {
      settle(() =>
        reject(new Error(`mock API exited before becoming ready (code ${code})`))
      );
    };

    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`mock API did not become ready within ${timeoutMs}ms`))
      );
    }, timeoutMs);

    server.stdout?.on("data", onData);
    server.once("error", onError);
    server.once("exit", onExit);
  });
}

describe("runner registration smoke harness", () => {
  test("serves deterministic registration and cleanup tokens", async () => {
    const tempRoot = makeTempRoot();
    const logPath = path.join(tempRoot, "mock-api.log");
    const port = 18080 + Number(process.env.VITEST_POOL_ID ?? "0");
    const host = "127.0.0.1";
    const server = spawn("node", ["scripts/smoke/mock-api.mjs"], {
      env: {
        ...process.env,
        MOCK_HOST: host,
        MOCK_LOG_PATH: logPath,
        MOCK_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "ignore"],
    });

    try {
      await waitForReady(server, host, port);

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
    const resolvedRunnerHome = fs.realpathSync(runnerHome);

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
      .toContain("config path: " + resolvedRunnerHome);
    expect(fs.readFileSync(path.join(tempRoot, "run-context.log"), "utf8"))
      .toContain("run path: " + resolvedRunnerHome);
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
