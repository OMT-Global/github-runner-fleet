import path from "node:path";
import type { DeploymentEnv } from "./env.js";
import { hasGitHubAuth } from "./github.js";
import { buildWindowsDockerRunnerStateDir } from "./windows-compose.js";
import type { ResolvedWindowsDockerConfig } from "./windows-config.js";

export interface WindowsDockerInstallConnection {
  host: string;
  port: string;
  username: string;
}

export interface WindowsDockerInstallProject {
  name: string;
  directory: string;
  composeFileName: string;
  envFileName: string;
  logFileName: string;
  deploymentScriptName: string;
}

export interface WindowsDockerInstallOptions {
  action: "up" | "down";
  pullImages: boolean;
  forceRecreate: boolean;
  removeOrphans: boolean;
  removeVolumes: boolean;
}

export interface WindowsDockerInstallPlan {
  connection: WindowsDockerInstallConnection;
  project: WindowsDockerInstallProject;
  options: WindowsDockerInstallOptions;
  stateDirectories: string[];
  composeContent: string;
  envFileContent: string;
  deploymentScript: string;
}

export interface WindowsDockerInstallSummary {
  connection: WindowsDockerInstallConnection;
  project: WindowsDockerInstallProject;
  options: WindowsDockerInstallOptions;
  stateDirectories: string[];
  envFilePreview: string;
  deploymentScript: string;
}

export interface BuildWindowsDockerInstallPlanOptions {
  allowIncomplete?: boolean;
  action?: "up" | "down";
}

export function buildWindowsDockerInstallPlan(
  config: ResolvedWindowsDockerConfig,
  env: DeploymentEnv,
  composeContent: string,
  buildOptions: BuildWindowsDockerInstallPlanOptions = {}
): WindowsDockerInstallPlan {
  const [firstPool] = config.pools;
  const missing: string[] = [];
  if (!firstPool.host) {
    missing.push("WINDOWS_DOCKER_HOST");
  }
  if (!firstPool.sshUser) {
    missing.push("WINDOWS_DOCKER_USERNAME");
  }
  if (!hasGitHubAuth(env)) {
    missing.push("GITHUB_PAT or GITHUB_APP_*");
  }

  if (missing.length > 0 && !buildOptions.allowIncomplete) {
    throw new Error(
      `missing required Windows Docker install env: ${missing.join(", ")}`
    );
  }

  const project: WindowsDockerInstallProject = {
    name: `${env.composeProjectName}-windows-docker`,
    directory: env.windowsDockerProjectDir,
    composeFileName: env.windowsDockerProjectComposeFile,
    envFileName: env.windowsDockerProjectEnvFile,
    logFileName: "install-project.log",
    deploymentScriptName: "Deploy-WindowsDocker.ps1"
  };
  const options: WindowsDockerInstallOptions = {
    action: buildOptions.action ?? "up",
    pullImages: env.windowsDockerInstallPullImages,
    forceRecreate: env.windowsDockerInstallForceRecreate,
    removeOrphans: env.windowsDockerInstallRemoveOrphans,
    removeVolumes: false
  };
  const stateDirectories = config.pools.flatMap((pool) =>
    Array.from({ length: pool.size }, (_unused, index) =>
      buildWindowsDockerRunnerStateDir(pool, index)
    )
  );

  return {
    connection: {
      host: firstPool.host,
      port: firstPool.sshPort,
      username: firstPool.sshUser
    },
    project,
    options,
    stateDirectories,
    composeContent,
    envFileContent: renderWindowsDockerComposeEnvFile(env),
    deploymentScript: renderWindowsDockerDeploymentScript(
      project,
      options,
      stateDirectories
    )
  };
}

export function summarizeWindowsDockerInstallPlan(
  plan: WindowsDockerInstallPlan
): WindowsDockerInstallSummary {
  return {
    connection: plan.connection,
    project: plan.project,
    options: plan.options,
    stateDirectories: plan.stateDirectories,
    envFilePreview: redactDotEnv(plan.envFileContent),
    deploymentScript: plan.deploymentScript
  };
}

export function renderWindowsDockerComposeEnvFile(env: DeploymentEnv): string {
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

function renderWindowsDockerDeploymentScript(
  project: WindowsDockerInstallProject,
  options: WindowsDockerInstallOptions,
  stateDirectories: string[]
): string {
  const composePath = path.win32.join(project.directory, project.composeFileName);
  const logPath = path.win32.join(project.directory, "logs", project.logFileName);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$ProjectDir = ${powerShellQuote(project.directory)}`,
    `$ComposeFile = ${powerShellQuote(composePath)}`,
    `$ProjectName = ${powerShellQuote(project.name)}`,
    `$LogFile = ${powerShellQuote(logPath)}`,
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null",
    "Start-Transcript -Path $LogFile -Append | Out-Null",
    "function Invoke-NativeCommand {",
    "  param([string]$FilePath, [string[]]$ArgumentList, [string]$Operation)",
    "  $Output = @(& $FilePath @ArgumentList 2>&1)",
    "  $ExitCode = $LASTEXITCODE",
    "  $Output | ForEach-Object { Write-Host $_ }",
    "  if ($ExitCode -ne 0) {",
    "    $CommandText = \"$FilePath $($ArgumentList -join ' ')\".Trim()",
    "    $Detail = (($Output | Select-Object -Last 20) -join [Environment]::NewLine)",
    "    throw \"$Operation failed: command '$CommandText' exited with code $ExitCode. $Detail\"",
    "  }",
    "}",
    "try {",
    "  Write-Host \"[install] $(Get-Date -Format o) starting $ProjectName\"",
    "  $Docker = (Get-Command docker -ErrorAction Stop).Source",
    `  $Directories = @(${[
      project.directory,
      path.win32.join(project.directory, "logs"),
      ...stateDirectories
    ]
      .map(powerShellQuote)
      .join(", ")})`,
    "  foreach ($Directory in $Directories) {",
    "    New-Item -ItemType Directory -Force -Path $Directory | Out-Null",
    "  }",
    "  Set-Location $ProjectDir",
    "  Invoke-NativeCommand -FilePath $Docker -ArgumentList @('compose', '-p', $ProjectName, '-f', $ComposeFile, 'config', '-q') -Operation 'docker compose config'"
  ];

  if (options.action === "up") {
    if (options.pullImages) {
      lines.push("  Invoke-NativeCommand -FilePath $Docker -ArgumentList @('compose', '-p', $ProjectName, '-f', $ComposeFile, 'pull') -Operation 'docker compose pull'");
    }

    const upArgs = ["up", "-d"];
    if (options.forceRecreate) {
      upArgs.push("--force-recreate");
    }
    if (options.removeOrphans) {
      upArgs.push("--remove-orphans");
    }
    lines.push(
      `  Invoke-NativeCommand -FilePath $Docker -ArgumentList @('compose', '-p', $ProjectName, '-f', $ComposeFile, ${upArgs.map(powerShellQuote).join(", ")}) -Operation 'docker compose up'`
    );
  } else {
    const downArgs = ["down"];
    if (options.removeOrphans) {
      downArgs.push("--remove-orphans");
    }
    if (options.removeVolumes) {
      downArgs.push("--volumes");
    }
    lines.push(
      `  Invoke-NativeCommand -FilePath $Docker -ArgumentList @('compose', '-p', $ProjectName, '-f', $ComposeFile, ${downArgs.map(powerShellQuote).join(", ")}) -Operation 'docker compose down'`
    );
  }

  lines.push(
    "  Invoke-NativeCommand -FilePath $Docker -ArgumentList @('compose', '-p', $ProjectName, '-f', $ComposeFile, 'ps') -Operation 'docker compose ps'",
    "  Write-Host \"[install] $(Get-Date -Format o) completed $ProjectName\"",
    "} finally {",
    "  Stop-Transcript | Out-Null",
    "}"
  );

  return `${lines.join("\r\n")}\r\n`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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
