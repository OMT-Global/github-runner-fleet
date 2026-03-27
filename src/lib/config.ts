import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { DeploymentEnv } from "./env.js";
import type { RunnerArchitecture } from "./runner-version.js";

export type RunnerVisibility = "private" | "public";

export interface PoolResources {
  cpus?: string;
  memory?: string;
  pidsLimit: number;
}

export interface PoolConfig {
  key: string;
  visibility: RunnerVisibility;
  organization: string;
  runnerGroup: string;
  allowedRepositories: string[];
  labels: string[];
  size: number;
  architecture: RunnerArchitecture;
  runnerRoot: string;
  resources: PoolResources;
  imageRef: string;
}

export interface ResolvedConfig {
  version: 1;
  image: {
    repository: string;
    tag: string;
  };
  pools: PoolConfig[];
}

const poolSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  visibility: z.enum(["private", "public"]),
  organization: z.string().min(1),
  runnerGroup: z.string().min(1),
  allowedRepositories: z
    .array(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/))
    .min(1),
  labels: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).default([]),
  size: z.number().int().min(1),
  architecture: z.enum(["amd64", "arm64"]),
  runnerRoot: z.string().min(1),
  resources: z
    .object({
      cpus: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      memory: z.string().min(1).optional(),
      pidsLimit: z.number().int().positive().default(256)
    })
    .default({ pidsLimit: 256 })
});

const configSchema = z.object({
  version: z.literal(1),
  image: z.object({
    repository: z.string().min(1),
    tag: z.string().min(1)
  }),
  pools: z.array(poolSchema).min(1)
});

export function loadConfig(
  configPath: string,
  env: DeploymentEnv
): ResolvedConfig {
  const absolutePath = path.resolve(configPath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const parsed = YAML.parse(source);
  const interpolated = interpolate(parsed, env.raw);
  const result = configSchema.parse(interpolated);

  const seenKeys = new Set<string>();
  const pools = result.pools.map((pool) => {
    if (seenKeys.has(pool.key)) {
      throw new Error(`duplicate pool key: ${pool.key}`);
    }
    seenKeys.add(pool.key);

    for (const repository of pool.allowedRepositories) {
      const [owner] = repository.split("/");
      if (owner !== pool.organization) {
        throw new Error(
          `pool ${pool.key} includes ${repository}, which is outside organization ${pool.organization}`
        );
      }
    }

    if (!path.isAbsolute(pool.runnerRoot)) {
      throw new Error(
        `pool ${pool.key} runnerRoot must resolve to an absolute path`
      );
    }

    return {
      ...pool,
      labels: uniqueLabels(pool.labels, pool.visibility),
      resources: {
        cpus: pool.resources.cpus,
        memory: pool.resources.memory,
        pidsLimit: pool.resources.pidsLimit ?? 256
      },
      imageRef: `${result.image.repository}:${result.image.tag}`
    };
  });

  return {
    version: result.version,
    image: result.image,
    pools
  };
}

function uniqueLabels(
  labels: string[],
  visibility: RunnerVisibility
): string[] {
  const merged = ["synology", "shell-only", visibility, ...labels];
  return [...new Set(merged)];
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
