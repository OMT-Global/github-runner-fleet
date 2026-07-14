import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

export interface RunBoundedCommandOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  spawn?: typeof spawnSync;
  now?: () => number;
}

export function runBoundedCommand(
  command: string,
  args: string[],
  errorPrefix: string,
  options: RunBoundedCommandOptions = {}
): string {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("command timeout must be a positive integer");
  }
  const now = options.now ?? Date.now;
  const startedAt = now();
  const result = (options.spawn ?? spawnSync)(command, args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    timeout: timeoutMs,
    killSignal: "SIGTERM"
  }) as SpawnSyncReturns<string>;
  const elapsedMs = Math.max(0, now() - startedAt);
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  const harmlessClosedInput = errorCode === "EPIPE" && result.status === 0;

  if ((result.error && !harmlessClosedInput) || result.status !== 0) {
    const timedOut = errorCode === "ETIMEDOUT";
    const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message ||
      `${command} exited with status ${result.status}`;
    throw new Error(
      `${errorPrefix}: operation=${command} target=${commandTarget(args)} elapsed_ms=${elapsedMs} retries=0 timeout_ms=${timeoutMs}${timedOut ? " timed_out=true" : ""}: ${detail}`
    );
  }

  return result.stdout ?? "";
}

export function sshTransportArgs(timeoutSeconds = 15): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${timeoutSeconds}`,
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2"
  ];
}

function commandTarget(args: string[]): string {
  return args.find((arg) => arg.includes("@")) ?? "local";
}
