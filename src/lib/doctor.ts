import fs from "node:fs";
import { auditLogFileFromEnv } from "./audit.js";
import { collectConfigWarnings, loadConfig } from "./config.js";
import { loadDeploymentEnv } from "./env.js";
import {
  type FetchLike,
  verifyContainerImageTag,
  verifyRunnerGroups
} from "./github.js";
import { log, type LogLevel } from "./logger.js";
import { loadLumeConfig } from "./lume-config.js";
import {
  defaultLumeProjectResultPath,
  loadLumeProjectResult
} from "./lume-project.js";
import {
  doctorCheckResult,
  emitMetrics,
  poolSlotCount,
  type MetricSample
} from "./metrics.js";

export type DoctorMode = "full" | "synology" | "lume";
export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  target: "synology" | "lume";
  status: DoctorCheckStatus;
  summary: string;
  detail?: string;
  data?: unknown;
}

export interface DoctorReport {
  ok: boolean;
  mode: DoctorMode;
  checks: DoctorCheck[];
}

export interface RunDoctorOptions {
  mode?: DoctorMode;
  envPath?: string;
  configPath?: string;
  lumeConfigPath?: string;
  fetchImpl?: FetchLike;
}

export async function runDoctor(
  options: RunDoctorOptions = {}
): Promise<DoctorReport> {
  const mode = options.mode ?? "full";
  const envPath = options.envPath ?? ".env";
  const configPath = options.configPath ?? "config/pools.yaml";
  const lumeConfigPath = options.lumeConfigPath ?? "config/lume-runners.yaml";
  const fetchImpl = options.fetchImpl;
  const env = loadDeploymentEnv({
    envPath,
    requirePat: false
  });
  const checks: DoctorCheck[] = [];

  if (mode === "full" || mode === "synology") {
    const synologyChecks = await runSynologyDoctor({
      env,
      configPath,
      fetchImpl
    });
    checks.push(...synologyChecks);
  }

  if (mode === "full" || mode === "lume") {
    const lumeChecks = await runLumeDoctor({
      env,
      configPath: lumeConfigPath,
      fetchImpl
    });
    checks.push(...lumeChecks);
  }

  const report = {
    ok: checks.every((check) => check.status !== "fail"),
    mode,
    checks
  };

  await emitDoctorObservability(report);
  return report;
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`doctor mode: ${report.mode}`];

  for (const check of report.checks) {
    lines.push(
      `${check.status.toUpperCase()} ${check.id}: ${check.summary}`
    );
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
  }

  const counts = countStatuses(report.checks);
  lines.push(
    `overall: ${report.ok ? "PASS" : "FAIL"} (${counts.pass} passed, ${counts.warn} warned, ${counts.fail} failed, ${counts.skip} skipped)`
  );
  return `${lines.join("\n")}\n`;
}

async function runSynologyDoctor(input: {
  env: ReturnType<typeof loadDeploymentEnv>;
  configPath: string;
  fetchImpl?: FetchLike;
}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(buildAuditLogCheck(input.env.raw));
  const missingDeploymentEnv = [
    ["GITHUB_PAT", input.env.githubPat],
    ["SYNOLOGY_HOST", input.env.synologyHost],
    ["SYNOLOGY_USERNAME", input.env.synologyUsername],
    ["SYNOLOGY_PASSWORD", input.env.synologyPassword]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  checks.push(
    missingDeploymentEnv.length === 0
      ? {
          id: "synology-env",
          target: "synology",
          status: "pass",
          summary: "required Synology deployment env is configured"
        }
      : {
          id: "synology-env",
          target: "synology",
          status: "fail",
          summary: "required Synology deployment env is incomplete",
          detail: `missing ${missingDeploymentEnv.join(", ")}`
        }
  );

  let config: ReturnType<typeof loadConfig> | undefined;
  try {
    config = loadConfig(input.configPath, input.env);
    checks.push({
      id: "synology-config",
      target: "synology",
      status: "pass",
      summary: `loaded ${input.configPath} with ${config.pools.length} pool${config.pools.length === 1 ? "" : "s"}`,
      data: {
        pools: config.pools.map((pool) => ({
          key: pool.key,
          size: pool.size
        }))
      }
    });
  } catch (error) {
    checks.push({
      id: "synology-config",
      target: "synology",
      status: "fail",
      summary: `failed to load ${input.configPath}`,
      detail: formatError(error)
    });
    return checks;
  }

  const warnings = collectConfigWarnings(config);
  checks.push(
    warnings.length === 0
      ? {
          id: "synology-config-warnings",
          target: "synology",
          status: "pass",
          summary: "no Synology config warnings were detected"
        }
      : {
          id: "synology-config-warnings",
          target: "synology",
          status: "warn",
          summary: `${warnings.length} Synology config warning${warnings.length === 1 ? "" : "s"} detected`,
          detail: warnings.join("; ")
        }
  );

  if (!input.env.githubPat) {
    checks.push({
      id: "synology-runner-groups",
      target: "synology",
      status: "skip",
      summary: "skipped Synology runner-group verification",
      detail: "GITHUB_PAT is not configured"
    });
    checks.push({
      id: "synology-image",
      target: "synology",
      status: "skip",
      summary: "skipped Synology image verification",
      detail: "GITHUB_PAT is not configured"
    });
    return checks;
  }

  try {
    const pools = await verifyRunnerGroups(
      input.env.githubApiUrl,
      input.env.githubPat,
      config.pools.map((pool) => ({
        poolKey: pool.key,
        organization: pool.organization,
        runnerGroup: pool.runnerGroup
      })),
      input.fetchImpl
    );
    checks.push({
      id: "synology-runner-groups",
      target: "synology",
      status: "pass",
      summary: `verified ${pools.length} Synology runner group${pools.length === 1 ? "" : "s"} in GitHub`
    });
  } catch (error) {
    checks.push({
      id: "synology-runner-groups",
      target: "synology",
      status: "fail",
      summary: "failed Synology runner-group verification",
      detail: formatError(error)
    });
  }

  const imageRef = `${config.image.repository}:${config.image.tag}`;
  try {
    const image = await verifyContainerImageTag(
      input.env.githubApiUrl,
      input.env.githubPat,
      imageRef,
      input.fetchImpl
    );
    checks.push({
      id: "synology-image",
      target: "synology",
      status: "pass",
      summary: `verified ${image.imageRef} in GitHub Packages`
    });
  } catch (error) {
    checks.push({
      id: "synology-image",
      target: "synology",
      status: "fail",
      summary: `failed image verification for ${imageRef}`,
      detail: formatError(error)
    });
  }

  return checks;
}

function buildAuditLogCheck(env: Record<string, string | undefined>): DoctorCheck {
  const filePath = auditLogFileFromEnv(env);
  let sizeBytes = 0;
  if (fs.existsSync(filePath)) {
    sizeBytes = fs.statSync(filePath).size;
  }

  return {
    id: "audit-log",
    target: "synology",
    status: "pass",
    summary: `audit log path ${filePath}`,
    detail: `size ${sizeBytes} bytes`,
    data: {
      auditLogFile: filePath,
      sizeBytes
    }
  };
}

async function runLumeDoctor(input: {
  env: ReturnType<typeof loadDeploymentEnv>;
  configPath: string;
  fetchImpl?: FetchLike;
}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const missingLumeEnv = [
    ["GITHUB_PAT", input.env.githubPat]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  checks.push(
    missingLumeEnv.length === 0
      ? {
          id: "lume-env",
          target: "lume",
          status: "pass",
          summary: "required Lume GitHub env is configured"
        }
      : {
          id: "lume-env",
          target: "lume",
          status: "fail",
          summary: "required Lume GitHub env is incomplete",
          detail: `missing ${missingLumeEnv.join(", ")}`
        }
  );

  let config: ReturnType<typeof loadLumeConfig> | undefined;
  try {
    config = loadLumeConfig(input.configPath, input.env);
    checks.push({
      id: "lume-config",
      target: "lume",
      status: "pass",
      summary: `loaded ${input.configPath} with ${config.pool.size} slot${config.pool.size === 1 ? "" : "s"}`,
      data: {
        pool: {
          key: config.pool.key,
          size: config.pool.size
        }
      }
    });
  } catch (error) {
    checks.push({
      id: "lume-config",
      target: "lume",
      status: "fail",
      summary: `failed to load ${input.configPath}`,
      detail: formatError(error)
    });
    return checks;
  }

  const envFileExists = fs.existsSync(config.host.envFile);
  checks.push(
    envFileExists
      ? {
          id: "lume-env-file",
          target: "lume",
          status: "pass",
          summary: `found Lume runner env file at ${config.host.envFile}`
        }
      : {
          id: "lume-env-file",
          target: "lume",
          status: "warn",
          summary: "Lume runner env file is missing",
          detail: `${config.host.envFile} does not exist yet`
        }
  );

  const projectResultPath = defaultLumeProjectResultPath(config);
  const projectResult = loadLumeProjectResult(projectResultPath);
  if (projectResult) {
    const healthy =
      projectResult.action === "install" &&
      (projectResult.status === "started" ||
        projectResult.status === "already-running");
    checks.push({
      id: "lume-project-result",
      target: "lume",
      status: healthy ? "pass" : "warn",
      summary: `latest Lume project result action=${projectResult.action} status=${projectResult.status}`,
      detail: `recorded ${projectResult.recordedAt} at ${projectResult.resultPath}`,
      data: {
        pool: {
          key: projectResult.pool.key,
          size: projectResult.pool.size
        }
      }
    });
  } else {
    checks.push({
      id: "lume-project-result",
      target: "lume",
      status: "warn",
      summary: "Lume project result artifact is missing",
      detail: `run install-lume-project to create ${projectResultPath}`
    });
  }

  if (!input.env.githubPat) {
    checks.push({
      id: "lume-runner-group",
      target: "lume",
      status: "skip",
      summary: "skipped Lume runner-group verification",
      detail: "GITHUB_PAT is not configured"
    });
    return checks;
  }

  try {
    await verifyRunnerGroups(
      input.env.githubApiUrl,
      input.env.githubPat,
      [
        {
          poolKey: config.pool.key,
          organization: config.pool.organization,
          runnerGroup: config.pool.runnerGroup
        }
      ],
      input.fetchImpl
    );
    checks.push({
      id: "lume-runner-group",
      target: "lume",
      status: "pass",
      summary: `verified Lume runner group ${config.pool.runnerGroup} in GitHub`
    });
  } catch (error) {
    checks.push({
      id: "lume-runner-group",
      target: "lume",
      status: "fail",
      summary: `failed Lume runner-group verification for ${config.pool.runnerGroup}`,
      detail: formatError(error)
    });
  }

  return checks;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countStatuses(checks: DoctorCheck[]): Record<DoctorCheckStatus, number> {
  return checks.reduce<Record<DoctorCheckStatus, number>>(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    {
      pass: 0,
      warn: 0,
      fail: 0,
      skip: 0
    }
  );
}

async function emitDoctorObservability(report: DoctorReport): Promise<void> {
  const samples: MetricSample[] = [];

  for (const check of report.checks) {
    logForDoctorCheck(check);
    samples.push(
      doctorCheckResult({
        check: check.id,
        status: check.status
      })
    );
    samples.push(...poolSlotMetricsForCheck(check));
  }

  await emitMetrics(samples);
}

function logForDoctorCheck(check: DoctorCheck): void {
  const level = levelForStatus(check.status);
  log[level]("doctor check result", {
    plane: check.target,
    pool: "n/a",
    check: check.id,
    status: check.status,
    summary: check.summary,
    ...(check.detail ? { detail: check.detail } : {})
  });
}

function levelForStatus(status: DoctorCheckStatus): LogLevel {
  if (status === "fail") {
    return "error";
  }
  if (status === "warn") {
    return "warn";
  }
  return "info";
}

function poolSlotMetricsForCheck(check: DoctorCheck): MetricSample[] {
  if (check.target === "synology" && isSynologyConfigData(check.data)) {
    return check.data.pools.map((pool) =>
      poolSlotCount({
        plane: "synology",
        pool: pool.key,
        count: pool.size
      })
    );
  }

  if (check.target === "lume" && isLumeConfigData(check.data)) {
    return [
      poolSlotCount({
        plane: "lume",
        pool: check.data.pool.key,
        count: check.data.pool.size
      })
    ];
  }

  return [];
}

function isSynologyConfigData(
  value: unknown
): value is { pools: Array<{ key: string; size: number }> } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { pools?: unknown }).pools) &&
    (value as { pools: unknown[] }).pools.every(
      (pool) =>
        typeof pool === "object" &&
        pool !== null &&
        typeof (pool as { key?: unknown }).key === "string" &&
        typeof (pool as { size?: unknown }).size === "number"
    )
  );
}

function isLumeConfigData(
  value: unknown
): value is { pool: { key: string; size: number } } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { pool?: unknown }).pool === "object" &&
    (value as { pool?: unknown }).pool !== null &&
    typeof ((value as { pool: { key?: unknown } }).pool.key) === "string" &&
    typeof ((value as { pool: { size?: unknown } }).pool.size) === "number"
  );
}
