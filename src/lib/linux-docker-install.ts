import path from "node:path";
import type { DeploymentEnv } from "./env.js";
import {
  buildLinuxDockerRunnerStateDir
} from "./linux-docker-compose.js";
import type { ResolvedLinuxDockerConfig } from "./linux-docker-config.js";

export interface LinuxDockerInstallConnection {
  host: string;
  port: string;
  username: string;
}

export interface LinuxDockerInstallProject {
  name: string;
  directory: string;
  composeFileName: string;
  envFileName: string;
  logFileName: string;
  deploymentScriptName: string;
}

export interface LinuxDockerInstallOptions {
  action: "up" | "down";
  pullImages: boolean;
  forceRecreate: boolean;
  removeOrphans: boolean;
  removeVolumes: boolean;
}

export interface LinuxDockerInstallPlan {
  connection: LinuxDockerInstallConnection;
  project: LinuxDockerInstallProject;
  options: LinuxDockerInstallOptions;
  stateDirectories: string[];
  composeContent: string;
  envFileContent: string;
  deploymentScript: string;
}

export interface LinuxDockerInstallSummary {
  connection: LinuxDockerInstallConnection;
  project: LinuxDockerInstallProject;
  options: LinuxDockerInstallOptions;
  stateDirectories: string[];
  envFilePreview: string;
  deploymentScript: string;
}

export interface BuildLinuxDockerInstallPlanOptions {
  allowIncomplete?: boolean;
  action?: "up" | "down";
}

export function buildLinuxDockerInstallPlan(
  config: ResolvedLinuxDockerConfig,
  env: DeploymentEnv,
  composeContent: string,
  buildOptions: BuildLinuxDockerInstallPlanOptions = {}
): LinuxDockerInstallPlan {
  const missing: string[] = [];
  if (!env.linuxDockerHost) {
    missing.push("LINUX_DOCKER_HOST");
  }
  if (!env.linuxDockerUsername) {
    missing.push("LINUX_DOCKER_USERNAME");
  }
  if (!env.githubPat) {
    missing.push("GITHUB_PAT");
  }

  if (missing.length > 0 && !buildOptions.allowIncomplete) {
    throw new Error(
      `missing required Linux Docker install env: ${missing.join(", ")}`
    );
  }

  const project: LinuxDockerInstallProject = {
    name: `${env.composeProjectName}-linux-docker`,
    directory: env.linuxDockerProjectDir,
    composeFileName: env.linuxDockerProjectComposeFile,
    envFileName: env.linuxDockerProjectEnvFile,
    logFileName: "install-project.log",
    deploymentScriptName: "deploy-linux-docker.sh"
  };
  const options: LinuxDockerInstallOptions = {
    action: buildOptions.action ?? "up",
    pullImages: env.linuxDockerInstallPullImages,
    forceRecreate: env.linuxDockerInstallForceRecreate,
    removeOrphans: env.linuxDockerInstallRemoveOrphans,
    removeVolumes: false
  };
  const stateDirectories = config.pools.flatMap((pool) =>
    Array.from({ length: pool.size }, (_unused, index) =>
      buildLinuxDockerRunnerStateDir(pool, index)
    )
  );

  return {
    connection: {
      host: env.linuxDockerHost ?? "",
      port: env.linuxDockerPort,
      username: env.linuxDockerUsername ?? ""
    },
    project,
    options,
    stateDirectories,
    composeContent,
    envFileContent: renderLinuxDockerComposeEnvFile(env),
    deploymentScript: renderLinuxDockerDeploymentScript(
      project,
      options,
      stateDirectories
    )
  };
}

export function summarizeLinuxDockerInstallPlan(
  plan: LinuxDockerInstallPlan
): LinuxDockerInstallSummary {
  return {
    connection: plan.connection,
    project: plan.project,
    options: plan.options,
    stateDirectories: plan.stateDirectories,
    envFilePreview: redactDotEnv(plan.envFileContent),
    deploymentScript: plan.deploymentScript
  };
}

export function renderLinuxDockerComposeEnvFile(env: DeploymentEnv): string {
  const entries: Array<[string, string]> = [
    ["GITHUB_PAT", env.githubPat ?? ""],
    ["GITHUB_API_URL", env.githubApiUrl]
  ];

  return `${entries
    .map(([key, value]) => `${key}=${quoteDotEnv(value)}`)
    .join("\n")}\n`;
}

function renderLinuxDockerDeploymentScript(
  project: LinuxDockerInstallProject,
  options: LinuxDockerInstallOptions,
  stateDirectories: string[]
): string {
  const lines = [
    "#!/bin/sh",
    "set -eu",
    `project_dir=${shellQuote(project.directory)}`,
    `compose_file=${shellQuote(project.composeFileName)}`,
    `project_name=${shellQuote(project.name)}`,
    `log_file=${shellQuote(path.posix.join(project.directory, "logs", project.logFileName))}`,
    'mkdir -p "$(dirname "$log_file")"',
    'exec >>"$log_file" 2>&1',
    'printf \'[install] %s starting %s\\n\' "$(date -Iseconds)" "$project_name"',
    "docker_bin=''",
    "for candidate in /usr/local/bin/docker /usr/bin/docker docker; do",
    "  if [ -x \"$candidate\" ]; then",
    "    docker_bin=\"$candidate\"",
    "    break",
    "  fi",
    "  if command -v \"$candidate\" >/dev/null 2>&1; then",
    "    docker_bin=\"$(command -v \"$candidate\")\"",
    "    break",
    "  fi",
    "done",
    'if [ -z "$docker_bin" ]; then',
    "  echo 'docker binary not found on Linux Docker host'",
    "  exit 1",
    "fi",
    `mkdir -p ${[
      shellQuote(project.directory),
      shellQuote(path.posix.join(project.directory, "logs")),
      ...stateDirectories.map((entry) => shellQuote(entry))
    ].join(" ")}`,
    'cd "$project_dir"',
    '"$docker_bin" compose -p "$project_name" -f "$compose_file" config -q'
  ];

  if (options.action === "up") {
    if (options.pullImages) {
      lines.push(
        '"$docker_bin" compose -p "$project_name" -f "$compose_file" pull'
      );
    }

    const upArgs = ['"$docker_bin" compose -p "$project_name" -f "$compose_file" up -d'];
    if (options.forceRecreate) {
      upArgs.push("--force-recreate");
    }
    if (options.removeOrphans) {
      upArgs.push("--remove-orphans");
    }
    lines.push(upArgs.join(" "));
  } else {
    const downArgs = ['"$docker_bin" compose -p "$project_name" -f "$compose_file" down'];
    if (options.removeOrphans) {
      downArgs.push("--remove-orphans");
    }
    if (options.removeVolumes) {
      downArgs.push("--volumes");
    }
    lines.push(downArgs.join(" "));
  }

  lines.push(
    '"$docker_bin" compose -p "$project_name" -f "$compose_file" ps',
    'printf \'[install] %s completed %s\\n\' "$(date -Iseconds)" "$project_name"'
  );

  return `${lines.join("\n")}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function quoteDotEnv(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"')}"`;
}

function redactDotEnv(content: string): string {
  return content.replace(/^([A-Z0-9_]+)=.*$/gm, "$1=<redacted>");
}
