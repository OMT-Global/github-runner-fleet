import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { DeploymentEnv } from "./env.js";
import type { RunnerArchitecture } from "./runner-version.js";

export type RunnerVisibility = "private" | "public";
export type RepositoryAccess = "all" | "selected";
export type RunnerPlatform = RunnerArchitecture | "auto";

export interface PoolResources {
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
}

export interface PoolScaling {
  min: number;
  max: number;
  queueThreshold: number;
  cooldownSeconds: number;
}

export interface PoolConfig {
  key: string;
  visibility: RunnerVisibility;
  organization: string;
  runnerGroup: string;
  repositoryAccess: RepositoryAccess;
  allowedRepositories: string[];
  labels: string[];
  size: number;
  architecture: RunnerPlatform;
  runnerRoot: string;
  resources: PoolResources;
  scaling?: PoolScaling;
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

export function collectConfigWarnings(config: ResolvedConfig): string[] {
  return config.pools.flatMap((pool) => {
    const warnings: string[] = [];

    if (pool.resources.cpus) {
      warnings.push(
        `pool ${pool.key} sets resources.cpus=${pool.resources.cpus}; Synology kernels often reject Docker NanoCPUs/CPU CFS limits, so prefer omitting cpus unless you have verified support on your NAS`
      );
    }

    if (pool.resources.pidsLimit !== undefined) {
      warnings.push(
        `pool ${pool.key} sets resources.pidsLimit=${pool.resources.pidsLimit}; Synology kernels often reject Docker PID cgroup limits, so prefer omitting pidsLimit unless you have verified support on your NAS`
      );
    }

    return warnings;
  });
}

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const poolSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    visibility: z.enum(["private", "public"]),
    organization: z.string().min(1),
    runnerGroup: z.string().min(1),
    repositoryAccess: z.enum(["all", "selected"]).default("selected"),
    allowedRepositories: z
      .array(z.string().regex(repositoryPattern))
      .default([]),
    labels: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).default([]),
    size: z.number().int().min(1),
    architecture: z.enum(["auto", "amd64", "arm64"]).default("auto"),
    runnerRoot: z.string().min(1),
    resources: z
      .object({
        cpus: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        memory: z.string().min(1).optional(),
        pidsLimit: z.number().int().positive().optional()
      })
      .default({}),
    scaling: z
      .object({
        min: z.number().int().min(1),
        max: z.number().int().min(1),
        queueThreshold: z.number().int().min(1),
        cooldownSeconds: z.number().int().min(0)
      })
      .optional()
  })
  .superRefine((pool, ctx) => {
    if (pool.repositoryAccess === "selected" && pool.allowedRepositories.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "allowedRepositories must contain at least one repository when repositoryAccess is selected",
        path: ["allowedRepositories"]
      });
    }

    if (pool.repositoryAccess === "all" && pool.allowedRepositories.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "allowedRepositories must be omitted when repositoryAccess is all",
        path: ["allowedRepositories"]
      });
    }

    if (pool.scaling && pool.scaling.min > pool.scaling.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scaling.min must be less than or equal to scaling.max",
        path: ["scaling", "min"]
      });
    }
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

    if (pool.repositoryAccess === "selected") {
      for (const repository of pool.allowedRepositories) {
        const [owner] = repository.split("/");
        if (owner !== pool.organization) {
          throw new Error(
            `pool ${pool.key} includes ${repository}, which is outside organization ${pool.organization}`
          );
        }
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
        pidsLimit: pool.resources.pidsLimit
      },
      scaling: pool.scaling,
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
