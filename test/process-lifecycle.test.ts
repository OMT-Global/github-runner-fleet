import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  terminateTrackedProcess,
  type ProcessLifecycleControl
} from "../src/lib/process-lifecycle.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("terminateTrackedProcess", () => {
  test("waits for a matching process to exit after SIGTERM", async () => {
    const fixture = createFixture("42");
    const signals: NodeJS.Signals[] = [];
    let runningChecks = 0;
    const control = createControl({
      command: "bash scripts/lume/run-slot.sh --slot 1",
      isRunning: () => ++runningChecks < 3,
      signal: (_pid, signal) => signals.push(signal)
    });

    await expect(terminateTrackedProcess({
      pidFile: fixture,
      expectedCommand: "run-slot.sh",
      pollIntervalMs: 1,
      timeoutMs: 5,
      control
    })).resolves.toBe("terminated");
    expect(signals).toEqual(["SIGTERM"]);
    expect(fs.existsSync(fixture)).toBe(false);
  });

  test("escalates only after the TERM deadline", async () => {
    const fixture = createFixture("42");
    const signals: NodeJS.Signals[] = [];
    let killed = false;
    const control = createControl({
      command: "bash scripts/lume/run-slot.sh --slot 1",
      isRunning: () => !killed,
      signal: (_pid, signal) => {
        signals.push(signal);
        killed ||= signal === "SIGKILL";
      }
    });

    await expect(terminateTrackedProcess({
      pidFile: fixture,
      expectedCommand: "run-slot.sh",
      pollIntervalMs: 1,
      timeoutMs: 2,
      control
    })).resolves.toBe("killed");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("refuses a reused pid without signaling or deleting its evidence", async () => {
    const fixture = createFixture("42");
    const signals: NodeJS.Signals[] = [];
    const control = createControl({
      command: "unrelated-important-process",
      isRunning: () => true,
      signal: (_pid, signal) => signals.push(signal)
    });

    await expect(terminateTrackedProcess({
      pidFile: fixture,
      expectedCommand: "run-slot.sh",
      control
    })).rejects.toThrow("refusing to signal pid 42");
    expect(signals).toEqual([]);
    expect(fs.readFileSync(fixture, "utf8")).toBe("42\n");
  });

  test("rejects malformed pid files", async () => {
    const fixture = createFixture("not-a-pid");
    await expect(terminateTrackedProcess({
      pidFile: fixture,
      expectedCommand: "run-slot.sh"
    })).rejects.toThrow("invalid pid file");
  });
});

function createFixture(value: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "process-lifecycle-"));
  tempDirectories.push(directory);
  const pidFile = path.join(directory, "worker.pid");
  fs.writeFileSync(pidFile, `${value}\n`, "utf8");
  return pidFile;
}

function createControl(options: {
  command: string;
  isRunning: () => boolean;
  signal: (pid: number, signal: NodeJS.Signals) => void;
}): ProcessLifecycleControl {
  return {
    commandFor: () => options.command,
    isRunning: options.isRunning,
    signal: options.signal,
    sleep: async () => undefined
  };
}
