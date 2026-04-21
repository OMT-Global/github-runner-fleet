import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { DeploymentEnv } from "./env.js";

export interface LumePoolConfig {
  key: string;
  organization: string;
  runnerGroup: string;
  labels: string[];
  size: number;
  vmBaseName: string;
  vmSlotPrefix: string;
  imageTag?: string;
  cpu: number;
  memory: string;
  diskSize: string;
  network: string;
  storage?: string;
  guestUser: string;
  guestPassword: string;
  guestRunnerRoot: string;
  guestWorkRoot: string;
  runnerVersion: string;
}

export interface LumeSlotManifest {
  index: number;
  slotKey: string;
  vmName: string;
  runnerName: string;
  runnerLabels: string;
  hostDir: string;
  workerPidFile: string;
  vmPidFile: string;
  workerLogFile: string;
  vmLogFile: string;
  guestStageDir: string;
  guestBootstrapPath: string;
  guestHelperPath: string;
  guestEnvPath: string;
}

export interface ResolvedLumeConfig {
  version: 1;
  host: {
    baseDir: string;
    envFile: string;
    ipswPath?: string;
    configPath: string;
  };
  pool: LumePoolConfig;
  slots: LumeSlotManifest[];
}

const poolSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  organization: z.string().min(1).default("omt-global"),
  runnerGroup: z.string().min(1).default("macos-private"),
  labels: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).default([]),
  size: z.number().int().min(1),
  vmBaseName: z.string().min(1),
  vmSlotPrefix: z.string().min(1),
  imageTag: z.string().min(1).optional(),
  cpu: z.number().int().positive().default(6),
  memory: z.string().min(1).default("14GB"),
  diskSize: z.string().min(1).default("80GB"),
  network: z.string().min(1).default("nat"),
  storage: z.string().min(1).optional(),
  guestUser: z.string().min(1).default("lume"),
  guestPassword: z.string().min(1).default("lume"),
  guestRunnerRoot: z.string().min(1).default("/Users/lume/actions-runner"),
  guestWorkRoot: z.string().min(1).default("/Users/lume/actions-runner/_work")
});

const configSchema = z.object({
  version: z.literal(1),
  pool: poolSchema
});

export function loadLumeConfig(
  configPath: string,
  env: DeploymentEnv
): ResolvedLumeConfig {
  const absolutePath = path.resolve(configPath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const parsed = YAML.parse(source);
  const interpolated = interpolate(parsed, env.raw);
  const result = configSchema.parse(interpolated);

  if (!path.isAbsolute(env.lumeRunnerBaseDir)) {
    throw new Error("LUME_RUNNER_BASE_DIR must resolve to an absolute path");
  }

  if (!path.isAbsolute(env.lumeRunnerEnvFile)) {
    throw new Error("LUME_RUNNER_ENV_FILE must resolve to an absolute path");
  }

  const normalizedLabels = normalizeLabels(result.pool.labels);
  const pool: LumePoolConfig = {
    ...result.pool,
    labels: normalizedLabels,
    runnerVersion: env.runnerVersion
  };

  const host = {
    baseDir: env.lumeRunnerBaseDir,
    envFile: env.lumeRunnerEnvFile,
    ipswPath: env.lumeRunnerIpswPath,
    configPath: absolutePath
  };

  return {
    version: result.version,
    host,
    pool,
    slots: buildSlots(pool, host.baseDir)
  };
}

export function renderLumeShellExports(
  config: ResolvedLumeConfig,
  slotIndex: number
): string {
  const slot = config.slots.find((entry) => entry.index === slotIndex);
  if (!slot) {
    throw new Error(`slot ${slotIndex} is outside configured pool size ${config.pool.size}`);
  }

  const values: Record<string, string> = {
    LUME_POOL_KEY: config.pool.key,
    LUME_POOL_SIZE: String(config.pool.size),
    LUME_VM_BASE_NAME: config.pool.vmBaseName,
    LUME_VM_SLOT_PREFIX: config.pool.vmSlotPrefix,
    LUME_VM_CPU: String(config.pool.cpu),
    LUME_VM_MEMORY: config.pool.memory,
    LUME_VM_DISK_SIZE: config.pool.diskSize,
    LUME_VM_NETWORK: config.pool.network,
    LUME_VM_STORAGE: config.pool.storage ?? "",
    LUME_IMAGE_TAG: config.pool.imageTag ?? "",
    LUME_HOST_BASE_DIR: config.host.baseDir,
    LUME_HOST_ENV_FILE: config.host.envFile,
    LUME_HOST_IPSW_PATH: config.host.ipswPath ?? "",
    LUME_CONFIG_PATH: config.host.configPath,
    GITHUB_ORG: config.pool.organization,
    RUNNER_GROUP: config.pool.runnerGroup,
    FLEET_POOL_KEY: config.pool.key,
    FLEET_PLANE: "lume",
    RUNNER_VERSION: config.pool.runnerVersion,
    RUNNER_LABELS: slot.runnerLabels,
    GUEST_USER: config.pool.guestUser,
    GUEST_PASSWORD: config.pool.guestPassword,
    RUNNER_ROOT: config.pool.guestRunnerRoot,
    RUNNER_WORK_DIR: config.pool.guestWorkRoot,
    LUME_SLOT_INDEX: String(slot.index),
    LUME_SLOT_KEY: slot.slotKey,
    LUME_VM_NAME: slot.vmName,
    RUNNER_NAME: slot.runnerName,
    LUME_SLOT_DIR: slot.hostDir,
    LUME_SLOT_WORKER_PID_FILE: slot.workerPidFile,
    LUME_SLOT_VM_PID_FILE: slot.vmPidFile,
    LUME_SLOT_LOG_FILE: slot.workerLogFile,
    LUME_SLOT_VM_LOG_FILE: slot.vmLogFile,
    LUME_GUEST_STAGE_DIR: slot.guestStageDir,
    LUME_GUEST_BOOTSTRAP_PATH: slot.guestBootstrapPath,
    LUME_GUEST_HELPER_PATH: slot.guestHelperPath,
    LUME_GUEST_ENV_PATH: slot.guestEnvPath
  };

  return `${Object.entries(values)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n")}\n`;
}

function buildSlots(pool: LumePoolConfig, baseDir: string): LumeSlotManifest[] {
  const slotsDir = path.join(baseDir, "slots");
  const logsDir = path.join(baseDir, "logs");
  return Array.from({ length: pool.size }, (_value, offset) => {
    const index = offset + 1;
    const slotKey = `slot-${String(index).padStart(2, "0")}`;
    const hostDir = path.join(slotsDir, slotKey);
    const vmName = `${pool.vmSlotPrefix}-${String(index).padStart(2, "0")}`;
    const guestStageDir = "/tmp/github-runner-fleet";
    return {
      index,
      slotKey,
      vmName,
      runnerName: vmName,
      runnerLabels: pool.labels.join(","),
      hostDir,
      workerPidFile: path.join(hostDir, "worker.pid"),
      vmPidFile: path.join(hostDir, "vm.pid"),
      workerLogFile: path.join(logsDir, `${slotKey}.log`),
      vmLogFile: path.join(logsDir, `${slotKey}-vm.log`),
      guestStageDir,
      guestBootstrapPath: `${guestStageDir}/macos-runner-bootstrap.sh`,
      guestHelperPath: `${guestStageDir}/github-runner-common.sh`,
      guestEnvPath: `${guestStageDir}/runner.env`
    };
  });
}

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(["self-hosted", "macos", "arm64", "private", ...labels])];
}

function interpolate(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(
      /\$\{([A-Z0-9_]+)(?::-(.*?))?\}/g,
      (_match, name: string, defaultValue?: string) => {
        const envValue = env[name];
        if (envValue !== undefined) {
          return envValue;
        }
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        throw new Error(`missing environment value for ${name}`);
      }
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, env));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        interpolate(nestedValue, env)
      ])
    );
  }

  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
