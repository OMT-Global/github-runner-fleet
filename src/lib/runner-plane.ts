import type { RepositoryAccess } from "./config.js";

export type DockerCapablePlane = "linux-docker" | "windows-docker";
export type RunnerPlane = "synology" | DockerCapablePlane;

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function repositoryAccessSchemaValues(): ["all", "selected"] {
  return ["all", "selected"];
}

export function validateRepositoryOwner(input: {
  plane: string;
  poolKey: string;
  organization: string;
  repositories: string[];
}): void {
  for (const repository of input.repositories) {
    const [owner] = repository.split("/");
    if (owner !== input.organization) {
      throw new Error(
        `${input.plane} pool ${input.poolKey} includes ${repository}, which is outside organization ${input.organization}`
      );
    }
  }
}

export function validateDockerRepositoryAccess(input: {
  plane: DockerCapablePlane;
  poolKey: string;
  repositoryAccess: RepositoryAccess;
  env: Record<string, string>;
}): void {
  if (input.repositoryAccess !== "all") {
    return;
  }

  const flagName =
    input.plane === "linux-docker"
      ? "LINUX_DOCKER_ALLOW_ALL_REPOSITORIES"
      : "WINDOWS_DOCKER_ALLOW_ALL_REPOSITORIES";
  if (input.env[flagName] === "true") {
    return;
  }

  throw new Error(
    `${input.plane} pool ${input.poolKey} uses repositoryAccess=all; set ${flagName}=true to explicitly allow all repositories on Docker-capable runners`
  );
}

export function uniqueRunnerLabels(
  defaultLabels: string[],
  labels: string[]
): string[] {
  return [...new Set([...defaultLabels, ...labels])];
}

export function buildCommonRunnerEnv(input: {
  organization: string;
  runnerName: string;
  runnerGroup: string;
  poolKey: string;
  plane: RunnerPlane;
  labels: string[];
  visibility: string;
  repositoryAccess: RepositoryAccess;
  runnerStateDir: string;
  runnerLogDir: string;
  runnerWorkDir: string;
  runnerTemp: string;
  runnerToolCache: string;
}): Record<string, string> {
  return {
    GITHUB_PAT: "${GITHUB_PAT}",
    GITHUB_API_URL: "${GITHUB_API_URL:-https://api.github.com}",
    GITHUB_ORG: input.organization,
    RUNNER_SCOPE: "organization",
    RUNNER_NAME: input.runnerName,
    RUNNER_GROUP: input.runnerGroup,
    FLEET_POOL_KEY: input.poolKey,
    FLEET_PLANE: input.plane,
    RUNNER_LABELS: input.labels.join(","),
    RUNNER_VISIBILITY: input.visibility,
    RUNNER_REPOSITORY_ACCESS: input.repositoryAccess,
    RUNNER_STATE_DIR: input.runnerStateDir,
    RUNNER_LOG_DIR: input.runnerLogDir,
    RUNNER_WORK_DIR: input.runnerWorkDir,
    RUNNER_TEMP: input.runnerTemp,
    RUNNER_TOOL_CACHE: input.runnerToolCache,
    AGENT_TOOLSDIRECTORY: input.runnerToolCache,
    RUNNER_EPHEMERAL: "true",
    RUNNER_DISABLE_UPDATE: "true"
  };
}

export function interpolateEnv(value: unknown, env: Record<string, string>): unknown {
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
    return value.map((item) => interpolateEnv(item, env));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        interpolateEnv(nestedValue, env)
      ])
    );
  }

  return value;
}

export { repositoryPattern };
