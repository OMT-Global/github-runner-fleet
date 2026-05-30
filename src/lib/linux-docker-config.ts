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
import {
  interpolateEnv,
  repositoryPattern,
  uniqueRunnerLabels,
  validateDockerRepositoryAccess,
  validateRepositoryOwner
} from "./runner-plane.js";
import { telemetrySchema, type TelemetryConfig } from "./telemetry.js";

export interface LinuxDockerPoolConfig {
  key: string;
  visibility: "private" | "public";
  organization: string;
  runnerGroup: string;
  repositoryAccess: RepositoryAccess;
  allowedRepositories: string[];
  labels: string[];
  size: number;
  architecture: RunnerPlatform;
  runnerRoot: string;
  resources: PoolResources;
  telemetry?: TelemetryConfig;
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

const poolSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    visibility: z.enum(["private", "public"]).default("private"),
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
    telemetry: telemetrySchema
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
  const interpolated = interpolateEnv(parsed, env.raw);
  const result = configSchema.parse(interpolated);

  const seenKeys = new Set<string>();
  const pools = result.pools.map((pool) => {
    const { telemetry, ...poolValues } = pool;
    if (seenKeys.has(pool.key)) {
      throw new Error(`duplicate linux-docker pool key: ${pool.key}`);
    }
    seenKeys.add(pool.key);

    if (pool.repositoryAccess === "selected") {
      validateRepositoryOwner({
        plane: "linux-docker",
        poolKey: pool.key,
        organization: pool.organization,
        repositories: pool.allowedRepositories
      });
    }
    validateDockerRepositoryAccess({
      plane: "linux-docker",
      poolKey: pool.key,
      repositoryAccess: pool.repositoryAccess,
      env: env.raw
    });

    if (!path.isAbsolute(pool.runnerRoot)) {
      throw new Error(
        `linux-docker pool ${pool.key} runnerRoot must resolve to an absolute path`
      );
    }

    return {
      ...poolValues,
      labels: uniqueRunnerLabels(
        ["linux", "shell-only", "synology", "docker-capable", pool.visibility],
        pool.labels
      ),
      resources: {
        cpus: pool.resources.cpus,
        memory: pool.resources.memory,
        pidsLimit: pool.resources.pidsLimit
      },
      ...(telemetry.enabled ? { telemetry } : {}),
      imageRef: `${result.image.repository}:${result.image.tag}`
    };
  });

  return {
    version: result.version,
    image: result.image,
    pools
  };
}
