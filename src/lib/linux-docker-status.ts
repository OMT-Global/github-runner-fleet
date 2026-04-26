import fs from "node:fs";
import path from "node:path";
import type { DeploymentEnv } from "./env.js";
import type { ResolvedLinuxDockerConfig } from "./linux-docker-config.js";
import {
  buildLinuxDockerInstallPlan,
  summarizeLinuxDockerInstallPlan,
  type LinuxDockerInstallPlan,
  type LinuxDockerInstallSummary
} from "./linux-docker-install.js";

export interface LinuxDockerSavedResult {
  ok: boolean;
  action?: "up" | "down";
  recordedAt?: string;
  remoteLogPath?: string;
  composePsOutput?: string;
  error?: string;
  connection?: {
    host?: string;
    port?: string;
    username?: string;
  };
  project?: {
    name?: string;
    directory?: string;
  };
  options?: Record<string, unknown>;
}

export interface LinuxDockerStatusCheck {
  key: string;
  ok: boolean;
  summary: string;
}

export interface LinuxDockerTroubleshootingHint {
  symptom: string;
  nextStep: string;
}

export interface LinuxDockerStatusReport {
  ok: boolean;
  summary: LinuxDockerInstallSummary;
  checks: LinuxDockerStatusCheck[];
  remoteLogPath: string;
  savedResultPath?: string;
  savedResult?: LinuxDockerSavedResult;
  troubleshooting: LinuxDockerTroubleshootingHint[];
}

export function buildLinuxDockerStatusReport(options: {
  config: ResolvedLinuxDockerConfig;
  env: DeploymentEnv;
  composeContent: string;
  savedResultPath?: string;
}): LinuxDockerStatusReport {
  const plan = buildLinuxDockerInstallPlan(
    options.config,
    options.env,
    options.composeContent,
    {
      allowIncomplete: true,
      action: "up"
    }
  );
  const summary = summarizeLinuxDockerInstallPlan(plan);
  const remoteLogPath = path.posix.join(
    plan.project.directory,
    "logs",
    plan.project.logFileName
  );
  const resolvedSavedResultPath = options.savedResultPath
    ? path.resolve(options.savedResultPath)
    : undefined;
  const checks = buildChecks(plan, resolvedSavedResultPath);
  const savedResult = resolvedSavedResultPath
    ? loadSavedResult(resolvedSavedResultPath)
    : undefined;

  if (savedResult && resolvedSavedResultPath) {
    checks.push(...buildSavedResultChecks(savedResult, resolvedSavedResultPath));
  } else if (resolvedSavedResultPath) {
    checks.push({
      key: "saved_result",
      ok: false,
      summary: `no saved Linux Docker result found at ${resolvedSavedResultPath}`
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    summary,
    checks,
    remoteLogPath,
    savedResultPath: resolvedSavedResultPath,
    savedResult,
    troubleshooting: buildTroubleshooting(plan, savedResult, remoteLogPath)
  };
}

export function formatLinuxDockerStatusText(
  report: LinuxDockerStatusReport
): string {
  const lines = [
    `linux-docker-status ok=${report.ok ? "true" : "false"}`,
    `project=${report.summary.project.name} host=${report.summary.connection.host || "<missing>"}`,
    `remote_log=${report.remoteLogPath}`
  ];

  for (const check of report.checks) {
    lines.push(`- [${check.ok ? "ok" : "fail"}] ${check.key}: ${check.summary}`);
  }

  if (report.savedResult?.action) {
    lines.push(`recent_action=${report.savedResult.action}`);
  }

  if (report.savedResult?.composePsOutput) {
    lines.push("recent_compose_ps:");
    for (const line of report.savedResult.composePsOutput.split("\n")) {
      if (line.trim()) {
        lines.push(`  ${line}`);
      }
    }
  }

  if (report.savedResult?.error) {
    lines.push(`recent_error=${report.savedResult.error}`);
  }

  lines.push("troubleshooting:");
  for (const hint of report.troubleshooting) {
    lines.push(`- ${hint.symptom}: ${hint.nextStep}`);
  }

  return `${lines.join("\n")}\n`;
}

export function saveLinuxDockerResult(
  outputPath: string,
  payload: LinuxDockerSavedResult
): LinuxDockerSavedResult {
  const record: LinuxDockerSavedResult = {
    ...payload,
    recordedAt: payload.recordedAt ?? new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outputPath),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
  return record;
}

function loadSavedResult(
  savedResultPath: string
): LinuxDockerSavedResult | undefined {
  const resolved = path.resolve(savedResultPath);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as LinuxDockerSavedResult;
}

function buildChecks(
  plan: LinuxDockerInstallPlan,
  savedResultPath?: string
): LinuxDockerStatusCheck[] {
  const connection = plan.connection;
  const githubPatConfigured = !plan.envFileContent.includes('GITHUB_PAT=""');
  return [
    {
      key: "linux_docker_env",
      ok: Boolean(connection.host && connection.username),
      summary:
        connection.host && connection.username
          ? `Linux Docker host ${connection.host}:${connection.port} SSH access is configured`
          : "LINUX_DOCKER_HOST or LINUX_DOCKER_USERNAME is missing"
    },
    {
      key: "github_pat",
      ok: githubPatConfigured,
      summary: githubPatConfigured
        ? "GITHUB_PAT is configured for remote runner registration"
        : "GITHUB_PAT is missing from the deployment env"
    },
    {
      key: "compose_project",
      ok: true,
      summary: `project ${plan.project.name} will deploy under ${plan.project.directory}`
    },
    {
      key: "saved_result_path",
      ok: savedResultPath ? fs.existsSync(path.resolve(savedResultPath)) : true,
      summary: savedResultPath
        ? fs.existsSync(path.resolve(savedResultPath))
          ? `saved result found at ${path.resolve(savedResultPath)}`
          : `save install output with --status-output or provide --result ${path.resolve(savedResultPath)}`
        : "use --result or --status-output to inspect the latest saved install result"
    }
  ];
}

function buildSavedResultChecks(
  savedResult: LinuxDockerSavedResult,
  savedResultPath: string
): LinuxDockerStatusCheck[] {
  const checks: LinuxDockerStatusCheck[] = [
    {
      key: "saved_result",
      ok: true,
      summary: `loaded saved Linux Docker result from ${path.resolve(savedResultPath)}`
    }
  ];

  checks.push({
    key: "recent_result",
    ok: savedResult.ok,
    summary: savedResult.ok
      ? `latest Linux Docker ${savedResult.action ?? "up"} action completed successfully`
      : `latest Linux Docker ${savedResult.action ?? "up"} action failed`
  });

  if (savedResult.remoteLogPath) {
    checks.push({
      key: "recent_log",
      ok: true,
      summary: `latest remote log path ${savedResult.remoteLogPath}`
    });
  }

  return checks;
}

function buildTroubleshooting(
  plan: LinuxDockerInstallPlan,
  savedResult: LinuxDockerSavedResult | undefined,
  remoteLogPath: string
): LinuxDockerTroubleshootingHint[] {
  const hints: LinuxDockerTroubleshootingHint[] = [
    {
      symptom: "GitHub auth or registration failures",
      nextStep:
        "Run `pnpm validate-linux-docker-github -- --config config/linux-docker-runners.yaml --env .env` and confirm GITHUB_PAT plus runner groups are still valid."
    },
    {
      symptom: "SSH connectivity or remote permission failures",
      nextStep:
        "Confirm the Linux Docker host is reachable over SSH with the configured user and that the target project directory is writable."
    },
    {
      symptom: "Docker binary or compose failures on the remote host",
      nextStep: `Inspect ${remoteLogPath} and verify Docker plus Compose are installed and available to the remote user.`
    },
    {
      symptom: "Need a clean teardown or recovery cycle",
      nextStep:
        "Run `pnpm teardown-linux-docker-project -- --config config/linux-docker-runners.yaml --env .env --status-output .tmp/linux-docker-status.json`, confirm the saved result, then reinstall."
    }
  ];

  if (savedResult && !savedResult.ok) {
    hints.unshift({
      symptom: "Latest saved install attempt failed",
      nextStep: savedResult.error
        ? `Start with ${remoteLogPath} and the saved error: ${savedResult.error}`
        : `Start with ${remoteLogPath} and the latest saved status result.`
    });
  }

  return hints;
}
