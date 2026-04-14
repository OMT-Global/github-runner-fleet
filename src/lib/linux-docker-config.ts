import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type {
  PoolResources,
  RepositoryAccess,
  RunnerPlatform
} from "./config.js";
import type { DeploymentEnv } from "./env.js";

export interface LinuxDockerPoolConfig {
  key: string;
  visibility: "private";
  organization: string;
  runnerGroup: string;
  repositoryAccess: RepositoryAccess;
  allowedRepositories: string[];
  labels: string[];
  size: number;
  architecture: RunnerPlatform;
  runnerRoot: string;
  resources: PoolResources;
  imageRef: string;
}

export interface ResolvedLinuxDockerConfig {
  version: 1;
  image: {
    repository: string;
    tag: string;
  };
  pools: LinuxDockerPoolConfig[];
}

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const poolSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
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
      .default({})
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
  });

const configSchema = z.object({
  version: z.literal(1),
  image: z.object({
    repository: z.string().min(1),
    tag: z.string().min(1)
  }),
  pools: z.array(poolSchema).min(1)
});

export function loadLinuxDockerConfig(
  configPath: string,
  env: DeploymentEnv
): ResolvedLinuxDockerConfig {
  const absolutePath = path.resolve(configPath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const parsed = YAML.parse(source);
  const interpolated = interpolate(parsed, env.raw);
  const result = configSchema.parse(interpolated);

  const seenKeys = new Set<string>();
  const pools = result.pools.map((pool) => {
    if (seenKeys.has(pool.key)) {
      throw new Error(`duplicate linux-docker pool key: ${pool.key}`);
    }
    seenKeys.add(pool.key);

    if (pool.repositoryAccess === "selected") {
      for (const repository of pool.allowedRepositories) {
        const [owner] = repository.split("/");
        if (owner !== pool.organization) {
          throw new Error(
            `linux-docker pool ${pool.key} includes ${repository}, which is outside organization ${pool.organization}`
          );
        }
      }
    }

    if (!path.isAbsolute(pool.runnerRoot)) {
      throw new Error(
        `linux-docker pool ${pool.key} runnerRoot must resolve to an absolute path`
      );
    }

    return {
      ...pool,
      visibility: "private" as const,
      labels: uniqueLabels(pool.labels),
      resources: {
        cpus: pool.resources.cpus,
        memory: pool.resources.memory,
        pidsLimit: pool.resources.pidsLimit
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

function uniqueLabels(labels: string[]): string[] {
  return [...new Set(["linux", "docker-capable", "private", ...labels])];
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
