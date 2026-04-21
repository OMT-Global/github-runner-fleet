import fs from "node:fs";
import path from "node:path";
import type { ResolvedLumeConfig } from "./lume-config.js";

export type LumeProjectAction = "install" | "teardown";
export type LumeProjectStatus =
  | "already-running"
  | "dry-run"
  | "started"
  | "stopped";

export interface LumeProjectResult {
  plane: "lume";
  action: LumeProjectAction;
  status: LumeProjectStatus;
  recordedAt: string;
  configPath: string;
  resultPath: string;
  pidFile: string;
  logFile: string;
  pool: {
    key: string;
    organization: string;
    runnerGroup: string;
    size: number;
  };
  slots: Array<{
    index: number;
    vmName: string;
    runnerName: string;
    hostDir: string;
  }>;
  supervisorPid?: number;
  drain?: {
    status: string;
    cordoned: string[];
    busy: string[];
    missing: string[];
  };
}

export function defaultLumeProjectResultPath(config: ResolvedLumeConfig): string {
  return path.join(config.host.baseDir, "lume-project-result.json");
}

export function defaultLumeProjectPidFile(config: ResolvedLumeConfig): string {
  return path.join(config.host.baseDir, "lume-project.pid");
}

export function defaultLumeProjectLogFile(config: ResolvedLumeConfig): string {
  return path.join(config.host.baseDir, "logs", "lume-project.log");
}

export function buildLumeProjectResult(input: {
  action: LumeProjectAction;
  status: LumeProjectStatus;
  config: ResolvedLumeConfig;
  resultPath: string;
  supervisorPid?: number;
  drain?: LumeProjectResult["drain"];
}): LumeProjectResult {
  return {
    plane: "lume",
    action: input.action,
    status: input.status,
    recordedAt: new Date().toISOString(),
    configPath: input.config.host.configPath,
    resultPath: path.resolve(input.resultPath),
    pidFile: defaultLumeProjectPidFile(input.config),
    logFile: defaultLumeProjectLogFile(input.config),
    pool: {
      key: input.config.pool.key,
      organization: input.config.pool.organization,
      runnerGroup: input.config.pool.runnerGroup,
      size: input.config.pool.size
    },
    slots: input.config.slots.map((slot) => ({
      index: slot.index,
      vmName: slot.vmName,
      runnerName: slot.runnerName,
      hostDir: slot.hostDir
    })),
    ...(input.supervisorPid ? { supervisorPid: input.supervisorPid } : {}),
    ...(input.drain ? { drain: input.drain } : {})
  };
}

export function saveLumeProjectResult(result: LumeProjectResult): void {
  fs.mkdirSync(path.dirname(result.resultPath), { recursive: true });
  fs.writeFileSync(result.resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function loadLumeProjectResult(
  resultPath: string
): LumeProjectResult | undefined {
  const resolvedPath = path.resolve(resultPath);
  if (!fs.existsSync(resolvedPath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as LumeProjectResult;
}

export function formatLumeProjectResultText(result: LumeProjectResult): string {
  const lines = [
    `lume-project action=${result.action} status=${result.status}`,
    `pool=${result.pool.key} slots=${result.pool.size}`,
    `pid_file=${result.pidFile}`,
    `log_file=${result.logFile}`,
    `result=${result.resultPath}`
  ];

  if (result.supervisorPid) {
    lines.push(`supervisor_pid=${result.supervisorPid}`);
  }

  if (result.drain) {
    lines.push(
      `drain=${result.drain.status} cordoned=${result.drain.cordoned.length} busy=${result.drain.busy.length} missing=${result.drain.missing.length}`
    );
  }

  for (const slot of result.slots) {
    lines.push(`- slot ${slot.index}: vm=${slot.vmName} runner=${slot.runnerName}`);
  }

  return `${lines.join("\n")}\n`;
}
