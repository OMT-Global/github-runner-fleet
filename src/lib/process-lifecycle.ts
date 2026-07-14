import fs from "node:fs";
import { spawnSync } from "node:child_process";

export interface ProcessLifecycleControl {
  commandFor(pid: number): string | undefined;
  isRunning(pid: number): boolean;
  signal(pid: number, signal: NodeJS.Signals): void;
  sleep(milliseconds: number): Promise<void>;
}

export interface TerminateTrackedProcessOptions {
  pidFile: string;
  expectedCommand: string;
  timeoutMs?: number;
  killTimeoutMs?: number;
  pollIntervalMs?: number;
  control?: ProcessLifecycleControl;
}

const defaultControl: ProcessLifecycleControl = {
  commandFor(pid) {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8"
    });
    return result.status === 0 ? result.stdout.trim() || undefined : undefined;
  },
  isRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  signal(pid, signal) {
    process.kill(pid, signal);
  },
  sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
};

export async function terminateTrackedProcess(
  options: TerminateTrackedProcessOptions
): Promise<"absent" | "stale" | "terminated" | "killed"> {
  const control = options.control ?? defaultControl;
  const pid = readTrackedPid(options.pidFile);
  if (pid === undefined) {
    return "absent";
  }

  if (!control.isRunning(pid)) {
    fs.rmSync(options.pidFile, { force: true });
    return "stale";
  }

  const command = control.commandFor(pid);
  if (!command || !command.includes(options.expectedCommand)) {
    throw new Error(
      `refusing to signal pid ${pid} from ${options.pidFile}: expected command containing ${JSON.stringify(options.expectedCommand)}, found ${JSON.stringify(command ?? "unknown")}`
    );
  }

  control.signal(pid, "SIGTERM");
  if (await waitUntilStopped(pid, options.timeoutMs ?? 10_000, options.pollIntervalMs ?? 100, control)) {
    fs.rmSync(options.pidFile, { force: true });
    return "terminated";
  }

  control.signal(pid, "SIGKILL");
  if (!(await waitUntilStopped(pid, options.killTimeoutMs ?? 2_000, options.pollIntervalMs ?? 100, control))) {
    throw new Error(`pid ${pid} remained alive after SIGKILL`);
  }
  fs.rmSync(options.pidFile, { force: true });
  return "killed";
}

function readTrackedPid(pidFile: string): number | undefined {
  if (!fs.existsSync(pidFile)) {
    return undefined;
  }
  const raw = fs.readFileSync(pidFile, "utf8").trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`invalid pid file ${pidFile}: ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}

async function waitUntilStopped(
  pid: number,
  timeoutMs: number,
  pollIntervalMs: number,
  control: ProcessLifecycleControl
): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!control.isRunning(pid)) {
      return true;
    }
    await control.sleep(pollIntervalMs);
  }
  return !control.isRunning(pid);
}
