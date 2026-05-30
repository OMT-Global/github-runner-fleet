import path from "node:path";
import type { ResolvedConfig } from "./config.js";
import { buildRunnerStateDir } from "./compose.js";
import type { DeploymentEnv } from "./env.js";
import { hasGitHubAuth } from "./github.js";

export interface SynologyInstallConnection {
  host: string;
  port: string;
  username: string;
  password: string;
  secure: boolean;
  certVerify: boolean;
  dsmVersion: number;
  apiRepo: string;
}

export interface SynologyInstallProject {
  name: string;
  directory: string;
  composeFileName: string;
  envFileName: string;
  logFileName: string;
}

export interface SynologyInstallOptions {
  action: "up" | "down";
  pullImages: boolean;
  forceRecreate: boolean;
  removeOrphans: boolean;
  removeVolumes: boolean;
}

export interface SynologyInstallPlan {
  connection: SynologyInstallConnection;
  project: SynologyInstallProject;
  options: SynologyInstallOptions;
  stateDirectories: string[];
  composeContent: string;
  envFileContent: string;
  deploymentScript: string;
}

export interface SynologyInstallSummary {
  connection: Omit<SynologyInstallConnection, "password"> & {
    passwordConfigured: boolean;
  };
  project: SynologyInstallProject;
  options: SynologyInstallOptions;
  stateDirectories: string[];
  envFilePreview: string;
  deploymentScript: string;
}

export interface BuildSynologyInstallPlanOptions {
  allowIncomplete?: boolean;
  action?: "up" | "down";
}

export function buildSynologyInstallPlan(
  config: ResolvedConfig,
  env: DeploymentEnv,
  composeContent: string,
  buildOptions: BuildSynologyInstallPlanOptions = {}
): SynologyInstallPlan {
  const missing: string[] = [];
  if (!env.synologyHost) {
    missing.push("SYNOLOGY_HOST");
  }
  if (!env.synologyUsername) {
    missing.push("SYNOLOGY_USERNAME");
  }
  if (!env.synologyPassword) {
    missing.push("SYNOLOGY_PASSWORD");
  }
  if (!hasGitHubAuth(env)) {
    missing.push("GITHUB_PAT or GITHUB_APP_*");
  }

  if (missing.length > 0 && !buildOptions.allowIncomplete) {
    throw new Error(
      `missing required Synology install env: ${missing.join(", ")}`
    );
  }

  const project: SynologyInstallProject = {
    name: env.composeProjectName,
    directory: env.synologyProjectDir,
    composeFileName: env.synologyProjectComposeFile,
    envFileName: env.synologyProjectEnvFile,
    logFileName: "install-project.log"
  };
  const options: SynologyInstallOptions = {
    action: buildOptions.action ?? "up",
    pullImages: env.synologyInstallPullImages,
    forceRecreate: env.synologyInstallForceRecreate,
    removeOrphans: env.synologyInstallRemoveOrphans,
    removeVolumes: false
  };
  const stateDirectories = config.pools.flatMap((pool) =>
    Array.from({ length: pool.size }, (_unused, index) =>
      buildRunnerStateDir(pool, index)
    )
  );

  return {
    connection: {
      host: env.synologyHost ?? "",
      port: env.synologyPort,
      username: env.synologyUsername ?? "",
      password: env.synologyPassword ?? "",
      secure: env.synologySecure,
      certVerify: env.synologyCertVerify,
      dsmVersion: env.synologyDsmVersion,
      apiRepo: env.synologyApiRepo
    },
    project,
    options,
    stateDirectories,
    composeContent,
    envFileContent: renderSynologyComposeEnvFile(env),
    deploymentScript: renderSynologyDeploymentScript(
      project,
      options,
      stateDirectories
    )
  };
}

export function summarizeSynologyInstallPlan(
  plan: SynologyInstallPlan
): SynologyInstallSummary {
  return {
    connection: {
      host: plan.connection.host,
      port: plan.connection.port,
      username: plan.connection.username,
      secure: plan.connection.secure,
      certVerify: plan.connection.certVerify,
      dsmVersion: plan.connection.dsmVersion,
      apiRepo: plan.connection.apiRepo,
      passwordConfigured: plan.connection.password.length > 0
    },
    project: plan.project,
    options: plan.options,
    stateDirectories: plan.stateDirectories,
    envFilePreview: redactDotEnv(plan.envFileContent),
    deploymentScript: plan.deploymentScript
  };
}

export function renderSynologyComposeEnvFile(env: DeploymentEnv): string {
  const entries: Array<[string, string]> = [
    ["GITHUB_PAT", env.githubPat ?? ""],
    ["GITHUB_APP_ID", env.githubAppId ?? ""],
    ["GITHUB_APP_INSTALLATION_ID", env.githubAppInstallationId ?? ""],
    ["GITHUB_APP_PRIVATE_KEY", env.githubAppPrivateKey ?? ""],
    ["GITHUB_API_URL", env.githubApiUrl]
  ];

  return `${entries
    .map(([key, value]) => `${key}=${quoteDotEnv(value)}`)
    .join("\n")}\n`;
}

function renderSynologyDeploymentScript(
  project: SynologyInstallProject,
  options: SynologyInstallOptions,
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
    "  echo 'docker binary not found on NAS'",
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
