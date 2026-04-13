import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "./config.js";
import type { DeploymentEnv } from "./env.js";
import {
  buildSynologyInstallPlan,
  summarizeSynologyInstallPlan,
  type SynologyInstallPlan,
  type SynologyInstallSummary
} from "./synology-install.js";

export interface SynologySavedResult {
  ok?: boolean;
  project?: {
    id?: number;
    name?: string;
    status?: string;
    path?: string;
    updated_at?: string;
  } | null;
  task?: {
    id?: number;
    result?: {
      exit_code?: number | string;
      start_time?: string;
      end_time?: string;
      extra?: unknown;
      [key: string]: unknown;
    };
  };
  remoteLogPath?: string;
  options?: Record<string, unknown>;
  recordedAt?: string;
  action?: "up" | "down";
}

export interface SynologyStatusCheck {
  key: string;
  ok: boolean;
  summary: string;
}

export interface SynologyTroubleshootingHint {
  symptom: string;
  nextStep: string;
}

export interface SynologyStatusReport {
  ok: boolean;
  summary: SynologyInstallSummary;
  checks: SynologyStatusCheck[];
  remoteLogPath: string;
  savedResultPath?: string;
  savedResult?: SynologySavedResult;
  troubleshooting: SynologyTroubleshootingHint[];
}

export function buildSynologyStatusReport(options: {
  config: ResolvedConfig;
  env: DeploymentEnv;
  composeContent: string;
  savedResultPath?: string;
}): SynologyStatusReport {
  const plan = buildSynologyInstallPlan(options.config, options.env, options.composeContent, {
    allowIncomplete: true,
    action: "up"
  });
  const summary = summarizeSynologyInstallPlan(plan);
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
      summary: `no saved Synology result found at ${resolvedSavedResultPath}`
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

export function formatSynologyStatusText(report: SynologyStatusReport): string {
  const lines = [
    `synology-status ok=${report.ok ? "true" : "false"}`,
    `project=${report.summary.project.name} host=${report.summary.connection.host || "<missing>"}`,
    `remote_log=${report.remoteLogPath}`
  ];

  for (const check of report.checks) {
    lines.push(`- [${check.ok ? "ok" : "fail"}] ${check.key}: ${check.summary}`);
  }

  if (report.savedResult?.task?.result) {
    const result = report.savedResult.task.result;
    lines.push(
      `recent_task exit_code=${String(result.exit_code ?? "unknown")} start=${String(result.start_time ?? "unknown")} end=${String(result.end_time ?? "unknown")}`
    );
  }

  if (report.savedResult?.project) {
    lines.push(
      `recent_project status=${String(report.savedResult.project.status ?? "unknown")} updated_at=${String(report.savedResult.project.updated_at ?? "unknown")}`
    );
  }

  lines.push("troubleshooting:");
  for (const hint of report.troubleshooting) {
    lines.push(`- ${hint.symptom}: ${hint.nextStep}`);
  }

  return `${lines.join("\n")}\n`;
}

export function saveSynologyResult(
  outputPath: string,
  action: "up" | "down",
  rawOutput: string
): SynologySavedResult {
  const parsed = JSON.parse(rawOutput) as SynologySavedResult;
  const record: SynologySavedResult = {
    ...parsed,
    action,
    recordedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function loadSavedResult(savedResultPath: string): SynologySavedResult | undefined {
  const resolved = path.resolve(savedResultPath);
  if (!fs.existsSync(resolved)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as SynologySavedResult;
}

function buildChecks(
  plan: SynologyInstallPlan,
  savedResultPath?: string
): SynologyStatusCheck[] {
  const connection = plan.connection;
  const githubPatConfigured = !plan.envFileContent.includes('GITHUB_PAT=""');
  return [
    {
      key: "synology_env",
      ok: Boolean(connection.host && connection.username && connection.password),
      summary:
        connection.host && connection.username && connection.password
          ? `Synology host ${connection.host}:${connection.port} credentials are configured`
          : "SYNOLOGY_HOST, SYNOLOGY_USERNAME, or SYNOLOGY_PASSWORD is missing"
    },
    {
      key: "github_pat",
      ok: githubPatConfigured,
      summary: githubPatConfigured
        ? "GITHUB_PAT is configured for remote runner registration"
        : "GITHUB_PAT is missing from the deployment env"
    },
    {
      key: "synology_api_repo",
      ok: fs.existsSync(connection.apiRepo),
      summary: fs.existsSync(connection.apiRepo)
        ? `synology-api repo found at ${connection.apiRepo}`
        : `synology-api repo not found at ${connection.apiRepo}`
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
  savedResult: SynologySavedResult,
  savedResultPath: string
): SynologyStatusCheck[] {
  const checks: SynologyStatusCheck[] = [
    {
      key: "saved_result",
      ok: true,
      summary: `loaded saved Synology result from ${path.resolve(savedResultPath)}`
    }
  ];

  if (savedResult.task?.result) {
    const exitCode = Number(savedResult.task.result.exit_code ?? 1);
    checks.push({
      key: "recent_task",
      ok: exitCode === 0,
      summary: `recent DSM task exit_code=${savedResult.task.result.exit_code ?? "unknown"}`
    });
  }

  if (savedResult.project) {
    const projectStatus = String(savedResult.project.status ?? "unknown");
    checks.push({
      key: "recent_project",
      ok: projectStatus !== "error",
      summary: `recent compose project status=${projectStatus}`
    });
  }

  return checks;
}

function buildTroubleshooting(
  plan: SynologyInstallPlan,
  savedResult: SynologySavedResult | undefined,
  remoteLogPath: string
): SynologyTroubleshootingHint[] {
  const hints: SynologyTroubleshootingHint[] = [
    {
      symptom: "GitHub auth or registration failures",
      nextStep: "Run `pnpm validate-github -- --config config/pools.yaml --env .env` and confirm GITHUB_PAT plus runner groups are still valid."
    },
    {
      symptom: "Image tag drift or missing image",
      nextStep: "Run `pnpm validate-image -- --config config/pools.yaml --env .env` before reinstalling so the NAS does not pull a nonexistent GHCR tag."
    },
    {
      symptom: "Synology path permission or bind-mount failures",
      nextStep: `Inspect ${remoteLogPath} and verify ${plan.project.directory} plus all runner state directories are writable on the NAS.`
    },
    {
      symptom: "Task execution failed or timed out",
      nextStep: `Review the DSM Task Scheduler result and the remote log at ${remoteLogPath}, then rerun \`pnpm install-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json\`.`
    },
    {
      symptom: "Need a clean teardown or recovery cycle",
      nextStep: "Run `pnpm teardown-synology-project -- --config config/pools.yaml --env .env --status-output .tmp/synology-status.json`, confirm the saved result, then reinstall."
    }
  ];

  if (savedResult?.task?.result && Number(savedResult.task.result.exit_code ?? 1) !== 0) {
    hints.unshift({
      symptom: "Latest saved install attempt failed",
      nextStep: `Start with ${remoteLogPath} and the saved task exit code ${String(savedResult.task.result.exit_code)}.`
    });
  }

  return hints;
}
