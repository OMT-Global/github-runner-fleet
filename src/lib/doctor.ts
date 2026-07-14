import fs from "node:fs";
import { auditLogFileFromEnv, inspectAuditLog } from "./audit.js";
import { collectConfigWarnings, loadConfig } from "./config.js";
import { loadDeploymentEnv } from "./env.js";
import { loadLinuxDockerConfig } from "./linux-docker-config.js";
import { loadWindowsDockerConfig } from "./windows-config.js";
import {
  describeGitHubAuth,
  type FetchLike,
  hasGitHubAuth,
  resolveGitHubAccessToken,
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

export type DoctorMode = "full" | "synology" | "linux-docker" | "windows-docker" | "lume";
export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip";
export type DoctorTarget = "synology" | "linux-docker" | "windows-docker" | "lume";

export interface DoctorCheck {
  id: string;
  target: DoctorTarget;
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
  linuxConfigPath?: string;
  linuxDockerConfigPath?: string;
  windowsConfigPath?: string;
  lumeConfigPath?: string;
  fetchImpl?: FetchLike;
}

export async function runDoctor(
  options: RunDoctorOptions = {}
): Promise<DoctorReport> {
  const mode = options.mode ?? "full";
  const envPath = options.envPath ?? ".env";
  const configPath = options.configPath ?? "config/pools.yaml";
  const linuxConfigPath =
    options.linuxConfigPath ??
    options.linuxDockerConfigPath ??
    "config/linux-docker-runners.yaml";
  const windowsConfigPath =
    options.windowsConfigPath ?? "config/windows-runners.yaml";
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

  if (mode === "full" || mode === "linux-docker") {
    const linuxDockerChecks = await runLinuxDockerDoctor({
      env,
      configPath: linuxConfigPath,
      fetchImpl
    });
    checks.push(...linuxDockerChecks);
  }

  if (mode === "full" || mode === "windows-docker") {
    const windowsDockerChecks = await runWindowsDockerDoctor({
      env,
      configPath: windowsConfigPath,
      fetchImpl
    });
    checks.push(...windowsDockerChecks);
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

async function runWindowsDockerDoctor(input: {
  env: ReturnType<typeof loadDeploymentEnv>;
  configPath: string;
  fetchImpl?: FetchLike;
}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const missingDeploymentEnv = hasGitHubAuth(input.env)
    ? []
    : ["GITHUB_PAT or GITHUB_APP_*"];

  checks.push(
    missingDeploymentEnv.length === 0
      ? {
          id: "windows-docker-env",
          target: "windows-docker",
          status: "pass",
          summary: `required Windows Docker GitHub env is configured via ${describeGitHubAuth(input.env)} auth`
        }
      : {
          id: "windows-docker-env",
          target: "windows-docker",
          status: "fail",
          summary: "required Windows Docker GitHub env is incomplete",
          detail: `missing ${missingDeploymentEnv.join(", ")}`
        }
  );

  let config: ReturnType<typeof loadWindowsDockerConfig> | undefined;
  try {
    config = loadWindowsDockerConfig(input.configPath, input.env);
    const missingHostFields = config.pools.flatMap((pool) => [
      ...(pool.host ? [] : [`${pool.key}:host`]),
      ...(pool.sshUser ? [] : [`${pool.key}:sshUser`])
    ]);
    checks.push({
      id: "windows-docker-config",
      target: "windows-docker",
      status: missingHostFields.length === 0 ? "pass" : "fail",
      summary:
        missingHostFields.length === 0
          ? `loaded ${input.configPath} with ${config.pools.length} pool${config.pools.length === 1 ? "" : "s"}`
          : "Windows Docker config is missing target host fields",
      detail:
        missingHostFields.length === 0
          ? undefined
          : `missing ${missingHostFields.join(", ")}`,
      data: {
        pools: config.pools.map((pool) => ({
          key: pool.key,
          size: pool.size
        }))
      }
    });
  } catch (error) {
    checks.push({
      id: "windows-docker-config",
      target: "windows-docker",
      status: "fail",
      summary: `failed to load ${input.configPath}`,
      detail: formatError(error)
    });
    return checks;
  }

  if (!hasGitHubAuth(input.env)) {
    checks.push({
      id: "windows-docker-runner-groups",
      target: "windows-docker",
      status: "skip",
      summary: "skipped Windows Docker runner-group verification",
      detail: "GitHub auth is not configured"
    });
    return checks;
  }

  try {
    const token = await resolveGitHubAccessToken(input.env, input.fetchImpl);
    const pools = await verifyRunnerGroups(
      input.env.githubApiUrl,
      token,
      config.pools.map((pool) => ({
        poolKey: pool.key,
        organization: pool.organization,
        runnerGroup: pool.runnerGroup
      })),
      input.fetchImpl
    );
    checks.push({
      id: "windows-docker-runner-groups",
      target: "windows-docker",
      status: "pass",
      summary: `verified ${pools.length} Windows Docker runner group${pools.length === 1 ? "" : "s"} in GitHub`
    });
  } catch (error) {
    checks.push({
      id: "windows-docker-runner-groups",
      target: "windows-docker",
      status: "fail",
      summary: "failed Windows Docker runner-group verification",
      detail: formatError(error)
    });
  }

  return checks;
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
    ["GITHUB_PAT or GITHUB_APP_*", hasGitHubAuth(input.env) ? "configured" : undefined],
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
  const webhookFreshnessCheck = buildAutoscaleWebhookFreshnessCheck(
    input.env.raw.AUTOSCALE_WEBHOOK_STATE_FILE,
    autoscalePollIntervalSeconds(input.env.raw.AUTOSCALE_POLL_INTERVAL_SECONDS)
  );
  if (webhookFreshnessCheck) {
    checks.push(webhookFreshnessCheck);
  }

  if (!hasGitHubAuth(input.env)) {
    checks.push({
      id: "synology-runner-groups",
      target: "synology",
      status: "skip",
      summary: "skipped Synology runner-group verification",
      detail: "GitHub auth is not configured"
    });
    checks.push({
      id: "synology-image",
      target: "synology",
      status: "skip",
      summary: "skipped Synology image verification",
      detail: "GitHub auth is not configured"
    });
    return checks;
  }

  try {
    const token = await resolveGitHubAccessToken(input.env, input.fetchImpl);
    const pools = await verifyRunnerGroups(
      input.env.githubApiUrl,
      token,
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
    const token = await resolveGitHubAccessToken(input.env, input.fetchImpl);
    const image = await verifyContainerImageTag(
      input.env.githubApiUrl,
      token,
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

function autoscalePollIntervalSeconds(raw: string | undefined): number {
  const parsed = Number(raw ?? "300");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 300;
}

function buildAutoscaleWebhookFreshnessCheck(
  statePath: string | undefined,
  staleAfterSeconds: number
): DoctorCheck | undefined {
  if (!statePath) {
    return undefined;
  }
  if (!fs.existsSync(statePath)) {
    return {
      id: "autoscale-webhook-freshness",
      target: "synology",
      status: "warn",
      summary: "autoscale webhook has not recorded workflow_job events",
      detail: `${statePath} does not exist yet`
    };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      lastEventAt?: string;
    };
    const lastEventAt = payload.lastEventAt ? Date.parse(payload.lastEventAt) : NaN;
    if (!Number.isFinite(lastEventAt)) {
      return {
        id: "autoscale-webhook-freshness",
        target: "synology",
        status: "warn",
        summary: "autoscale webhook state has no valid last event timestamp",
        detail: statePath
      };
    }
    const ageSeconds = Math.floor((Date.now() - lastEventAt) / 1000);
    return {
      id: "autoscale-webhook-freshness",
      target: "synology",
      status: ageSeconds > staleAfterSeconds ? "warn" : "pass",
      summary:
        ageSeconds > staleAfterSeconds
          ? "autoscale webhook events are stale"
          : "autoscale webhook has recent workflow_job events",
      detail: `last event ${ageSeconds}s ago; stale threshold ${staleAfterSeconds}s`
    };
  } catch (error) {
    return {
      id: "autoscale-webhook-freshness",
      target: "synology",
      status: "warn",
      summary: "failed to read autoscale webhook state",
      detail: formatError(error)
    };
  }
}

async function runLinuxDockerDoctor(input: {
  env: ReturnType<typeof loadDeploymentEnv>;
  configPath: string;
  fetchImpl?: FetchLike;
}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const missingDeploymentEnv = [
    ["GITHUB_PAT or GITHUB_APP_*", hasGitHubAuth(input.env) ? "configured" : undefined],
    ["LINUX_DOCKER_HOST", input.env.linuxDockerHost],
    ["LINUX_DOCKER_USERNAME", input.env.linuxDockerUsername]
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  checks.push(
    missingDeploymentEnv.length === 0
      ? {
          id: "linux-docker-env",
          target: "linux-docker",
          status: "pass",
          summary: "required Linux Docker deployment env is configured"
        }
      : {
          id: "linux-docker-env",
          target: "linux-docker",
          status: "fail",
          summary: "required Linux Docker deployment env is incomplete",
          detail: `missing ${missingDeploymentEnv.join(", ")}`
        }
  );

  let config: ReturnType<typeof loadLinuxDockerConfig> | undefined;
  try {
    config = loadLinuxDockerConfig(input.configPath, input.env);
    checks.push({
      id: "linux-docker-config",
      target: "linux-docker",
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
      id: "linux-docker-config",
      target: "linux-docker",
      status: "fail",
      summary: `failed to load ${input.configPath}`,
      detail: formatError(error)
    });
    return checks;
  }

  checks.push({
    id: "linux-docker-host-root",
    target: "linux-docker",
    status: "pass",
    summary: `Linux Docker project root resolves to ${input.env.linuxDockerProjectDir}`
  });

  if (!hasGitHubAuth(input.env)) {
    checks.push({
      id: "linux-docker-runner-groups",
      target: "linux-docker",
      status: "skip",
      summary: "skipped Linux Docker runner-group verification",
      detail: "GitHub auth is not configured"
    });
    checks.push({
      id: "linux-docker-image",
      target: "linux-docker",
      status: "skip",
      summary: "skipped Linux Docker image verification",
      detail: "GitHub auth is not configured"
    });
    return checks;
  }

  try {
    const token = await resolveGitHubAccessToken(input.env, input.fetchImpl);
    const pools = await verifyRunnerGroups(
      input.env.githubApiUrl,
      token,
      config.pools.map((pool) => ({
        poolKey: pool.key,
        organization: pool.organization,
        runnerGroup: pool.runnerGroup
      })),
      input.fetchImpl
    );
    checks.push({
      id: "linux-docker-runner-groups",
      target: "linux-docker",
      status: "pass",
      summary: `verified ${pools.length} Linux Docker runner group${pools.length === 1 ? "" : "s"} in GitHub`
    });
  } catch (error) {
    checks.push({
      id: "linux-docker-runner-groups",
      target: "linux-docker",
      status: "fail",
      summary: "failed Linux Docker runner-group verification",
      detail: formatError(error)
    });
  }

  const imageRef = `${config.image.repository}:${config.image.tag}`;
  try {
    const token = await resolveGitHubAccessToken(input.env, input.fetchImpl);
    const image = await verifyContainerImageTag(
      input.env.githubApiUrl,
      token,
      imageRef,
      input.fetchImpl
    );
    checks.push({
      id: "linux-docker-image",
      target: "linux-docker",
      status: "pass",
      summary: `verified ${image.imageRef} in GitHub Packages`
    });
  } catch (error) {
    checks.push({
      id: "linux-docker-image",
      target: "linux-docker",
      status: "fail",
      summary: `failed image verification for ${imageRef}`,
      detail: formatError(error)
    });
  }

  return checks;
}

function buildAuditLogCheck(env: Record<string, string | undefined>): DoctorCheck {
  const filePath = auditLogFileFromEnv(env);
  const staleAfter = Number(env.AUDIT_LOG_STALE_AFTER_SECONDS ?? "86400");
  const health = inspectAuditLog(filePath, Number.isFinite(staleAfter) && staleAfter > 0 ? staleAfter : 86_400);

  return {
    id: "audit-log",
    target: "synology",
    status: health.status === "healthy" ? "pass" : health.status === "unwritable" ? "fail" : "warn",
    summary: `audit log ${health.status}: ${filePath}`,
    detail: health.detail,
    data: {
      auditLogFile: filePath,
      sizeBytes: health.sizeBytes,
      ageSeconds: health.ageSeconds,
      health: health.status
    }
  };
}

async function runLumeDoctor(input: {
  env: ReturnType<typeof loadDeploymentEnv>;
  configPath: string;
  fetchImpl?: FetchLike;
}): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const missingLumeEnv = hasGitHubAuth(input.env)
    ? []
    : ["GITHUB_PAT or GITHUB_APP_*"];

  checks.push(
    missingLumeEnv.length === 0
      ? {
          id: "lume-env",
          target: "lume",
          status: "pass",
          summary: `required Lume GitHub env is configured via ${describeGitHubAuth(input.env)} auth`
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

  if (!hasGitHubAuth(input.env)) {
    checks.push({
      id: "lume-runner-group",
      target: "lume",
      status: "skip",
      summary: "skipped Lume runner-group verification",
      detail: "GitHub auth is not configured"
    });
    return checks;
  }

  try {
    const token = await resolveGitHubAccessToken(input.env, input.fetchImpl);
    await verifyRunnerGroups(
      input.env.githubApiUrl,
      token,
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
  if (isPoolConfigData(check.data)) {
    return check.data.pools.map((pool) =>
      poolSlotCount({
        plane: check.target,
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

function isPoolConfigData(
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
