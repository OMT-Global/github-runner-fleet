import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { PoolResources, RepositoryAccess } from "./config.js";
import type { DeploymentEnv } from "./env.js";

export interface WindowsDockerPoolConfig {
  key: string;
  visibility: "private";
  organization: string;
  runnerGroup: string;
  repositoryAccess: RepositoryAccess;
  allowedRepositories: string[];
  labels: string[];
  size: number;
  host: string;
  sshUser: string;
  sshPort: string;
  runnerRoot: string;
  resources: PoolResources;
  imageRef: string;
}

export interface ResolvedWindowsDockerConfig {
  version: 1;
  plane: "windows-docker";
  image?: {
    repository: string;
    tag: string;
  };
  pools: WindowsDockerPoolConfig[];
}

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const windowsAbsolutePathPattern = /^[A-Za-z]:[\\/]/;

const poolSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    organization: z.string().min(1).optional(),
    runnerGroup: z.string().min(1).optional(),
    group: z.string().min(1).optional(),
    repositoryAccess: z.enum(["all", "selected"]).default("selected"),
    allowedRepositories: z
      .array(z.string().regex(repositoryPattern))
      .optional(),
    repositories: z.array(z.string().regex(repositoryPattern)).optional(),
    labels: z.array(z.string().regex(/^[A-Za-z0-9._-]+$/)).default([]),
    size: z.number().int().min(1).optional(),
    slots: z.number().int().min(1).optional(),
    host: z.string().min(1).optional(),
    sshUser: z.string().min(1).optional(),
    sshPort: z.string().regex(/^\d+$/).optional(),
    image: z.string().min(1).optional(),
    runnerRoot: z.string().min(1).optional(),
    resources: z
      .object({
        cpus: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        memory: z.string().min(1).optional(),
        pidsLimit: z.number().int().positive().optional()
      })
      .default({})
  })
  .superRefine((pool, ctx) => {
    if (!pool.key && !pool.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "key or name is required",
        path: ["key"]
      });
    }

    if (!pool.runnerGroup && !pool.group) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "runnerGroup or group is required",
        path: ["runnerGroup"]
      });
    }

    const repositories = pool.allowedRepositories ?? pool.repositories ?? [];
    if (pool.repositoryAccess === "selected" && repositories.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "repositories must contain at least one repository when repositoryAccess is selected",
        path: ["repositories"]
      });
    }

    if (pool.repositoryAccess === "all" && repositories.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "repositories must be omitted when repositoryAccess is all",
        path: ["repositories"]
      });
    }
  });

const configSchema = z.object({
  version: z.literal(1).default(1),
  plane: z.literal("windows-docker"),
  image: z
    .object({
      repository: z.string().min(1),
      tag: z.string().min(1)
    })
    .optional(),
  pools: z.array(poolSchema).min(1)
});

export function loadWindowsDockerConfig(
  configPath: string,
  env: DeploymentEnv
): ResolvedWindowsDockerConfig {
  const absolutePath = path.resolve(configPath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const parsed = YAML.parse(source);
  const interpolated = interpolate(parsed, env.raw);
  const result = configSchema.parse(interpolated);

  const seenKeys = new Set<string>();
  const pools = result.pools.map((pool) => {
    const key = pool.key ?? pool.name!;
    if (seenKeys.has(key)) {
      throw new Error(`duplicate windows-docker pool key: ${key}`);
    }
    seenKeys.add(key);

    const allowedRepositories = pool.allowedRepositories ?? pool.repositories ?? [];
    const organization = pool.organization ?? inferOrganization(key, allowedRepositories);
    if (pool.repositoryAccess === "selected") {
      for (const repository of allowedRepositories) {
        const [owner] = repository.split("/");
        if (owner !== organization) {
          throw new Error(
            `windows-docker pool ${key} includes ${repository}, which is outside organization ${organization}`
          );
        }
      }
    }

    const runnerRoot = path.win32.normalize(
      pool.runnerRoot ??
        path.win32.join(env.windowsDockerRunnerBaseDir, "pools", key)
    );
    if (!windowsAbsolutePathPattern.test(runnerRoot)) {
      throw new Error(
        `windows-docker pool ${key} runnerRoot must resolve to an absolute Windows path`
      );
    }

    const imageRef =
      pool.image ??
      (result.image ? `${result.image.repository}:${result.image.tag}` : undefined);
    if (!imageRef) {
      throw new Error(
        `windows-docker pool ${key} must set image or use a top-level image repository and tag`
      );
    }

    return {
      key,
      visibility: "private" as const,
      organization,
      runnerGroup: pool.runnerGroup ?? pool.group!,
      repositoryAccess: pool.repositoryAccess,
      allowedRepositories,
      labels: uniqueLabels(pool.labels),
      size: pool.size ?? pool.slots ?? 1,
      host: pool.host ?? env.windowsDockerHost ?? "",
      sshUser: pool.sshUser ?? env.windowsDockerUsername ?? "",
      sshPort: pool.sshPort ?? env.windowsDockerPort,
      runnerRoot,
      resources: {
        cpus: pool.resources.cpus,
        memory: pool.resources.memory,
        pidsLimit: pool.resources.pidsLimit
      },
      imageRef
    };
  });

  validateSingleInstallHost(pools);

  return {
    version: result.version,
    plane: result.plane,
    image: result.image,
    pools
  };
}

function inferOrganization(key: string, repositories: string[]): string {
  const [organization] = repositories[0]?.split("/") ?? [];
  if (!organization) {
    throw new Error(
      `windows-docker pool ${key} must set organization when repositoryAccess is all`
    );
  }
  return organization;
}

function validateSingleInstallHost(pools: WindowsDockerPoolConfig[]): void {
  const [first] = pools;
  for (const pool of pools.slice(1)) {
    if (
      pool.host !== first.host ||
      pool.sshUser !== first.sshUser ||
      pool.sshPort !== first.sshPort
    ) {
      throw new Error(
        "windows-docker pools in one config must target the same host, sshUser, and sshPort"
      );
    }
  }
}

function uniqueLabels(labels: string[]): string[] {
  return [...new Set(["windows", "docker-capable", "private", ...labels])];
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
