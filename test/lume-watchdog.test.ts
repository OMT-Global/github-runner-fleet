import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("Lume watchdog and timeout guards", () => {
  test("run_with_timeout bounds a hung command with exit 124", () => {
    const startedAt = Date.now();
    const result = runBash([
      'source "scripts/lume/lib.sh"',
      "status=0",
      "run_with_timeout 1 sleep 30 || status=$?",
      'printf "status=%s\\n" "${status}"'
    ]);
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("status=124");
    expect(elapsedMs).toBeLessThan(15000);
  });

  test("run_with_timeout propagates output and exit codes of bounded commands", () => {
    const result = runBash([
      'source "scripts/lume/lib.sh"',
      "status=0",
      "run_with_timeout 20 bash -c 'echo hello; exit 3' || status=$?",
      'printf "status=%s\\n" "${status}"'
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.stdout).toContain("status=3");
  });

  test("listener health probe reports an alive listener with stale diagnostics", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-probe-"));
    try {
      const runnerRoot = path.join(directory, "actions-runner");
      fs.mkdirSync(path.join(runnerRoot, "_diag"), { recursive: true });
      fs.writeFileSync(path.join(runnerRoot, ".runner"), "{}\n", "utf8");
      fs.writeFileSync(path.join(runnerRoot, "_diag", "Runner_1.log"), "old\n", "utf8");

      const stubDir = path.join(directory, "bin");
      fs.mkdirSync(stubDir);
      const statEpoch = path.join(directory, "stat-epoch");
      fs.writeFileSync(
        statEpoch,
        `${Math.floor(Date.now() / 1000) - 42}\n`,
        "utf8"
      );
      writeExecutable(path.join(stubDir, "pgrep"), ["#!/bin/bash", "exit 0"]);
      writeExecutable(path.join(stubDir, "stat"), [
        "#!/bin/bash",
        'cat "${STAT_EPOCH}"'
      ]);

      const result = spawnSync(
        "bash",
        [path.resolve("scripts/guest/listener-health-probe.sh")],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            RUNNER_ROOT: runnerRoot,
            STAT_EPOCH: statEpoch,
            PATH: `${stubDir}:${process.env.PATH ?? ""}`
          }
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(
        /^listener=alive runner_file=yes diag_age=4[0-6]$/
      );
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  test("listener health probe reports an absent listener without registration", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-probe-"));
    try {
      const runnerRoot = path.join(directory, "actions-runner");
      fs.mkdirSync(runnerRoot, { recursive: true });
      const stubDir = path.join(directory, "bin");
      fs.mkdirSync(stubDir);
      writeExecutable(path.join(stubDir, "pgrep"), ["#!/bin/bash", "exit 1"]);

      const result = spawnSync(
        "bash",
        [path.resolve("scripts/guest/listener-health-probe.sh")],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            RUNNER_ROOT: runnerRoot,
            PATH: `${stubDir}:${process.env.PATH ?? ""}`
          }
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        "listener=absent runner_file=no diag_age=na"
      );
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  test("bootstrap kills stale runner processes inherited from the base image", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-stale-"));
    try {
      const runnerRoot = path.join(directory, "actions-runner");
      fs.mkdirSync(path.join(runnerRoot, "bin"), { recursive: true });
      const helperCmd = path.join(runnerRoot, "bin", "Runner.Listener");

      const result = runBash(
        [
          'source "scripts/lib/github-runner-common.sh"',
          "log() { printf '%s\\n' \"$*\" >&2; }",
          "audit_event() { printf 'audit=%s\\n' \"$1\"; }",
          "eval \"$(sed -n '/^kill_stale_runner_processes() {/,/^}/p' scripts/guest/macos-runner-bootstrap.sh)\"",
          "bash -c 'exec -a \"${HELPER_CMD}\" sleep 30' &",
          "stale_pid=$!",
          "sleep 0.3",
          "kill_stale_runner_processes",
          "if kill -0 \"${stale_pid}\" 2>/dev/null; then printf 'STILL_ALIVE\\n'; else printf 'KILLED\\n'; fi",
          "kill \"${stale_pid}\" >/dev/null 2>&1 || true",
          "wait 2>/dev/null || true"
        ],
        { HELPER_CMD: helperCmd }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("audit=stale_runner_process_killed");
      expect(result.stdout).toContain("KILLED");
    } finally {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  test("watch_guest_session flags a zombie listener while jobs are queued", () => {
    const result = runWatchHarness({
      probeLine: "listener=alive runner_file=yes diag_age=5000",
      queuedOutput: "3",
      helperCommand: "sleep 30"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verdict=zombie");
    expect(result.stderr).toContain("zombie listener");
    expect(result.stderr).toContain("queued_jobs=3");
  });

  test("watch_guest_session falls back to the hard staleness bound when the queue check fails", () => {
    const result = runWatchHarness({
      probeLine: "listener=alive runner_file=yes diag_age=7200",
      queuedExit: 1,
      helperCommand: "sleep 30"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verdict=zombie");
    expect(result.stderr).toContain("hard staleness bound");
  });

  test("watch_guest_session does not recycle a stale listener while the queue is empty", () => {
    const result = runWatchHarness({
      probeLine: "listener=alive runner_file=yes diag_age=1500",
      queuedOutput: "0",
      helperCommand: "sleep 0.4"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verdict=exited");
    expect(result.stdout).not.toContain("verdict=zombie");
  });

  test("watch_guest_session reports unreachable after repeated probe failures", () => {
    const result = runWatchHarness({
      probeExit: 1,
      helperCommand: "sleep 30"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("verdict=unreachable");
    expect(result.stderr).toContain("(3/3)");
  });

  test("destroy-slot.sh bounds a hung lume stop and still deletes the VM", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-destroy-"));
    let helperPid = 0;
    try {
      const stubDir = path.join(directory, "bin");
      fs.mkdirSync(stubDir, { recursive: true });
      const commandLog = path.join(directory, "commands.log");
      const manifest = path.join(directory, "manifest.sh");
      const vmPidFile = path.join(directory, "vm.pid");

      fs.writeFileSync(
        manifest,
        [
          "export LUME_VM_NAME='macos-runner-slot-01'",
          "export LUME_VM_STORAGE=''",
          `export LUME_SLOT_VM_PID_FILE='${vmPidFile}'`
        ].join("\n") + "\n",
        "utf8"
      );
      writeExecutable(path.join(stubDir, "pnpm"), [
        "#!/bin/bash",
        'if [[ "$*" == *render-lume-runner-manifest* ]]; then',
        '  cat "${MANIFEST_FIXTURE}"',
        "  exit 0",
        "fi",
        'echo "unexpected pnpm invocation: $*" >&2',
        "exit 1"
      ]);
      writeExecutable(path.join(stubDir, "lume"), [
        "#!/bin/bash",
        'printf "%s\\n" "lume $*" >> "${COMMAND_LOG}"',
        'case "$1" in',
        "  get) exit 0 ;;",
        "  stop) exec sleep 60 ;;",
        "  delete) exit 0 ;;",
        "esac",
        "exit 0"
      ]);

      // Orphan the helper (backgrounded nohup double-fork) so init reaps it
      // when the timeout guard kills it; a vitest-owned child would linger as
      // a zombie during the blocking spawnSync below and defeat kill -0.
      const helperLaunch = spawnSync(
        "bash",
        [
          "-c",
          'nohup bash -c \'exec -a "lume run macos-runner-slot-01" sleep 60\' >/dev/null 2>&1 & echo $!'
        ],
        { encoding: "utf8" }
      );
      helperPid = Number(helperLaunch.stdout.trim());
      expect(Number.isInteger(helperPid)).toBe(true);
      expect(helperPid).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      fs.writeFileSync(vmPidFile, `${helperPid}\n`, "utf8");

      const startedAt = Date.now();
      const result = spawnSync(
        "bash",
        [
          path.resolve("scripts/lume/destroy-slot.sh"),
          "--slot",
          "1",
          "--config",
          "config/lume-runners.yaml",
          "--env",
          ".env"
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${stubDir}:${process.env.PATH ?? ""}`,
            MANIFEST_FIXTURE: manifest,
            COMMAND_LOG: commandLog,
            LUME_VM_STOP_TIMEOUT_SECONDS: "1",
            LUME_VM_DELETE_TIMEOUT_SECONDS: "5"
          }
        }
      );
      const elapsedMs = Date.now() - startedAt;

      expect(result.status).toBe(0);
      expect(elapsedMs).toBeLessThan(20000);
      expect(result.stdout).toContain("timed out");

      const commands = fs.readFileSync(commandLog, "utf8");
      expect(commands).toContain("lume stop macos-runner-slot-01");
      expect(commands).toContain("lume delete macos-runner-slot-01 --force");
      expect(fs.existsSync(vmPidFile)).toBe(false);

      let helperAlive = true;
      try {
        process.kill(helperPid, 0);
      } catch {
        helperAlive = false;
      }
      expect(helperAlive).toBe(false);
    } finally {
      try {
        if (helperPid > 0) {
          process.kill(helperPid, "SIGKILL");
        }
      } catch {
        // helper already gone
      }
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });
});

function runBash(
  lines: string[],
  env: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", ["-c", lines.join("\n")], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runWatchHarness(options: {
  probeLine?: string;
  probeExit?: number;
  queuedOutput?: string;
  queuedExit?: number;
  helperCommand: string;
}): { status: number | null; stdout: string; stderr: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-watch-"));
  const pidFile = path.join(directory, "bootstrap.pid");
  try {
    return runBash(
      [
        'source "scripts/lume/lib.sh"',
        "log() { printf '%s\\n' \"$*\" >&2; }",
        "sleep() { :; }",
        "probe_guest_listener_health() {",
        '  if [[ "${PROBE_EXIT:-0}" != "0" ]]; then return "${PROBE_EXIT}"; fi',
        "  printf '%s\\n' \"${PROBE_LINE:-}\"",
        "}",
        "fetch_queued_job_count() {",
        '  if [[ "${QUEUED_EXIT:-0}" != "0" ]]; then return "${QUEUED_EXIT}"; fi',
        "  printf '%s\\n' \"${QUEUED_OUTPUT:-}\"",
        "}",
        "LUME_VM_NAME=macos-runner-slot-01",
        '( exec -a "lume ssh macos-runner-slot-01" ${HELPER_COMMAND} ) &',
        "helper_pid=$!",
        "printf '%s' \"${helper_pid}\" > \"${PID_FILE}\"",
        'watch_guest_session "${PID_FILE}" config.yaml env.file ""',
        "printf 'verdict=%s\\n' \"${WATCHDOG_VERDICT}\"",
        'kill "${helper_pid}" >/dev/null 2>&1 || true',
        'wait "${helper_pid}" 2>/dev/null || true'
      ],
      {
        PID_FILE: pidFile,
        HELPER_COMMAND: options.helperCommand,
        PROBE_LINE: options.probeLine ?? "",
        PROBE_EXIT: String(options.probeExit ?? 0),
        QUEUED_OUTPUT: options.queuedOutput ?? "",
        QUEUED_EXIT: String(options.queuedExit ?? 0)
      }
    );
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

function writeExecutable(filePath: string, contents: string[]): void {
  fs.writeFileSync(filePath, `${contents.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o755
  });
}
