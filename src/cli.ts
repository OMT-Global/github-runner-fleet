import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { decideAutoscale, type AutoscaleDecision } from "./lib/autoscale.js";
import { collectConfigWarnings, loadConfig, type ResolvedConfig } from "./lib/config.js";
import { renderCompose } from "./lib/compose.js";
import {
  auditLogFileFromEnv,
  auditMaxSizeBytesFromEnv,
  readJsonFromStdin,
  writeAuditRecord
} from "./lib/audit.js";
import {
  drainRunnerPool,
  type DrainProgress,
  type DrainReport
} from "./lib/drain.js";
import { loadDeploymentEnv } from "./lib/env.js";
import { loadLinuxDockerConfig } from "./lib/linux-docker-config.js";
import {
  buildLinuxDockerInstallPlan,
  summarizeLinuxDockerInstallPlan
} from "./lib/linux-docker-install.js";
import { renderLinuxDockerCompose } from "./lib/linux-docker-compose.js";
import { loadWindowsDockerConfig } from "./lib/windows-config.js";
import {
  buildWindowsDockerInstallPlan,
  summarizeWindowsDockerInstallPlan
} from "./lib/windows-install.js";
import { renderWindowsDockerCompose } from "./lib/windows-compose.js";
import {
  loadLumeConfig,
  renderLumeShellExports
} from "./lib/lume-config.js";
import {
  buildLumeProjectResult,
  defaultLumeProjectLogFile,
  defaultLumeProjectPidFile,
  defaultLumeProjectResultPath,
  formatLumeProjectResultText,
  saveLumeProjectResult,
  type LumeProjectResult
} from "./lib/lume-project.js";
import { renderDoctorReport, runDoctor, type DoctorMode } from "./lib/doctor.js";
import {
  collectGitHubActualPoolState,
  compareDesiredActualPools,
  desiredPoolsFromConfig,
  type DriftReport
} from "./lib/drift.js";
import {
  fetchOrganizationRunnerGroups,
  fetchOrganizationRunners,
  fetchLatestRunnerRelease,
  getQueuedJobCount,
  verifyContainerImageTag,
  verifyRunnerGroups
} from "./lib/github.js";
import {
  buildRunnerDownloadUrl,
  summarizeRunnerVersion
} from "./lib/runner-version.js";
import {
  buildSynologyInstallPlan,
  summarizeSynologyInstallPlan
} from "./lib/synology-install.js";

export async function main(
  commandLineArgs = process.argv.slice(2)
): Promise<void> {
  const [command, ...args] = commandLineArgs;

  switch (command) {
    case "validate-config":
      await validateConfig(args);
      break;
    case "doctor":
      await doctorCommand(args);
      break;
    case "drift-detect":
      await driftDetectCommand(args);
      break;
    case "audit-log":
      await auditLogCommand(args);
      break;
    case "scale":
      await scaleCommand(args);
      break;
    case "drain-pool":
      await drainPoolCommand(args);
      break;
    case "validate-linux-docker-config":
      await validateLinuxDockerConfig(args);
      break;
    case "validate-linux-docker-github":
      await validateLinuxDockerGitHub(args);
      break;
    case "validate-windows-config":
      await validateWindowsDockerConfig(args);
      break;
    case "validate-windows-github":
      await validateWindowsDockerGitHub(args);
      break;
    case "validate-github":
      await validateGitHub(args);
      break;
    case "validate-image":
      await validateImage(args);
      break;
    case "render-linux-docker-compose":
      await renderLinuxDockerComposeCommand(args);
      break;
    case "render-linux-docker-project-manifest":
      await renderLinuxDockerProjectManifest(args);
      break;
    case "render-windows-compose":
      await renderWindowsDockerComposeCommand(args);
      break;
    case "render-windows-project-manifest":
      await renderWindowsDockerProjectManifest(args);
      break;
    case "render-compose":
      await renderComposeCommand(args);
      break;
    case "render-synology-project-manifest":
      await renderSynologyProjectManifest(args);
      break;
    case "install-linux-docker-project":
      await installLinuxDockerProject(args);
      break;
    case "install-synology-project":
      await installSynologyProject(args);
      break;
    case "teardown-linux-docker-project":
      await teardownLinuxDockerProject(args);
      break;
    case "install-windows-project":
      await installWindowsDockerProject(args);
      break;
    case "teardown-windows-project":
      await teardownWindowsDockerProject(args);
      break;
    case "teardown-synology-project":
      await teardownSynologyProject(args);
      break;
    case "check-runner-version":
      await checkRunnerVersion(args);
      break;
    case "runner-release-manifest":
      await runnerReleaseManifest(args);
      break;
    case "validate-lume-config":
      await validateLumeConfig(args);
      break;
    case "validate-lume-github":
      await validateLumeGitHub(args);
      break;
    case "render-lume-runner-manifest":
      await renderLumeRunnerManifest(args);
      break;
    case "install-lume-project":
      await installLumeProject(args);
      break;
    case "teardown-lume-project":
      await teardownLumeProject(args);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

async function validateConfig(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);

  process.stdout.write(
    JSON.stringify(
      {
        version: config.version,
        image: config.image,
        pools: config.pools.map((pool) => ({
          key: pool.key,
          runnerGroup: pool.runnerGroup,
          visibility: pool.visibility,
          labels: pool.labels,
          size: pool.size,
          scaling: pool.scaling,
          architecture: pool.architecture,
          runnerRoot: pool.runnerRoot
        }))
      },
      null,
      2
    )
  );
}

async function doctorCommand(args: string[]): Promise<void> {
  const mode = getDoctorMode(args);
  const format = getOption(args, "--format", "text");
  if (format !== "text" && format !== "json") {
    throw new Error(`unknown doctor format: ${format}`);
  }
  const report = await runDoctor({
    mode,
    envPath: getOption(args, "--env", ".env"),
    configPath: getOption(args, "--config", "config/pools.yaml"),
    lumeConfigPath: getOption(args, "--lume-config", "config/lume-runners.yaml")
  });

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(renderDoctorReport(report));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function driftDetectCommand(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const threshold = parseNonNegativeInteger(
    getOption(args, "--threshold", env.raw.DRIFT_THRESHOLD ?? "0")!,
    "--threshold"
  );
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const desiredPools = desiredPoolsFromConfig(config.pools);
  const actualPools = await collectGitHubActualPoolState(
    env.githubApiUrl,
    env.githubPat!,
    desiredPools
  );
  const report = compareDesiredActualPools(
    desiredPools,
    actualPools,
    threshold
  );

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.drifted) {
    writeDriftNotification(
      report,
      env.raw.DRIFT_NOTIFY_CHANNEL,
      env.raw.GITHUB_STEP_SUMMARY
    );
    process.exitCode = 1;
  }
}

async function auditLogCommand(args: string[]): Promise<void> {
  const filePath = getOption(args, "--file", auditLogFileFromEnv());
  const maxSizeOption = getOption(args, "--max-size-bytes");
  const maxSizeBytes = maxSizeOption
    ? parsePositiveInteger(maxSizeOption, "--max-size-bytes")
    : auditMaxSizeBytesFromEnv();
  const record = writeAuditRecord(await readJsonFromStdin(), {
    filePath,
    maxSizeBytes
  });

  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function scaleCommand(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/pools.yaml")!;
  const poolFilter = getOption(args, "--pool");
  const config = loadConfig(configPath, env);
  emitWarnings(config);
  const cooldownElapsedSeconds = getConfigAgeSeconds(configPath);
  const pools = poolFilter
    ? config.pools.filter((pool) => pool.key === poolFilter)
    : config.pools;

  if (poolFilter && pools.length === 0) {
    throw new Error(`unknown pool: ${poolFilter}`);
  }

  const decisions: AutoscaleDecision[] = [];
  for (const pool of pools) {
    const queuedJobs = await getQueuedJobCount(env.githubApiUrl, env.githubPat!, {
      organization: pool.organization,
      runnerGroup: pool.runnerGroup,
      repositories:
        pool.repositoryAccess === "selected" ? pool.allowedRepositories : [],
      labels: pool.labels
    });
    decisions.push(
      decideAutoscale({
        poolKey: pool.key,
        currentSize: pool.size,
        queuedJobs,
        scaling: pool.scaling,
        cooldownElapsedSeconds
      })
    );
  }

  const report = {
    dryRun,
    cooldownElapsedSeconds,
    pools: decisions
  };

  if (dryRun || decisions.every((decision) => decision.action === "none")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const drainTimeoutSeconds = parseDurationSeconds(
    getOption(args, "--drain-timeout", "300")!,
    "--drain-timeout"
  );
  const drainIntervalSeconds = parseDurationSeconds(
    getOption(args, "--drain-interval", "5")!,
    "--drain-interval"
  );

  for (const decision of decisions.filter(
    (entry) => entry.action === "scale-down"
  )) {
    const pool = config.pools.find((entry) => entry.key === decision.poolKey)!;
    const report = await drainRunnerPool({
      apiUrl: env.githubApiUrl,
      token: env.githubPat!,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup,
      poolKey: pool.key,
      runnerNames: buildIndexedRunnerNames(
        pool.key,
        decision.targetSize + 1,
        pool.size
      ),
      timeoutSeconds: drainTimeoutSeconds,
      intervalSeconds: drainIntervalSeconds
    });
    if (report.status === "timeout") {
      throw new Error(
        `timed out waiting for ${report.busy.join(", ")} to become idle before scaling ${pool.key} down`
      );
    }
  }

  const scaledConfig = applyAutoscaleDecisions(config, decisions);
  const compose = renderCompose(scaledConfig, env);
  const plan = buildSynologyInstallPlan(scaledConfig, env, compose, {
    action: "up"
  });
  runSynologyInstallPlan(plan, getOption(args, "--python", "python3")!);
  writeScaledPoolSizes(configPath, decisions);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function drainPoolCommand(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const poolKey = getOption(args, "--pool");
  if (!poolKey) {
    throw new Error("--pool is required");
  }

  const format = getOption(args, "--format", "text");
  if (format !== "text" && format !== "json") {
    throw new Error(`unknown drain format: ${format}`);
  }

  const definition = resolveDrainPoolDefinition(args, env, poolKey);
  const report = await drainRunnerPool({
    apiUrl: env.githubApiUrl,
    token: env.githubPat!,
    organization: definition.organization,
    runnerGroup: definition.runnerGroup,
    poolKey: definition.key,
    runnerNames: definition.runnerNames,
    timeoutSeconds: parseDurationSeconds(getOption(args, "--timeout", "300")!, "--timeout"),
    intervalSeconds: parseDurationSeconds(getOption(args, "--interval", "5")!, "--interval"),
    onProgress:
      format === "text"
        ? (progress) => writeDrainProgress(definition.plane, progress)
        : undefined
  });

  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ ...report, plane: definition.plane }, null, 2)}\n`);
  } else {
    process.stdout.write(renderDrainReport(definition.plane, report));
  }

  if (report.status === "timeout") {
    process.exitCode = 1;
  }
}

function writeDriftNotification(
  report: DriftReport,
  channel: string | undefined,
  stepSummaryPath: string | undefined
): void {
  const normalizedChannel = channel?.trim();
  if (!normalizedChannel) {
    return;
  }

  if (!stepSummaryPath) {
    process.stderr.write(
      "DRIFT_NOTIFY_CHANNEL is set, but GITHUB_STEP_SUMMARY is unavailable; no drift notification was written.\n"
    );
    return;
  }

  const driftedPools = report.pools.filter((pool) => pool.status !== "ok");
  const rows = driftedPools
    .map(
      (pool) =>
        `| ${pool.name} | ${pool.desired} | ${pool.actual} | ${pool.drift} | ${pool.status} |`
    )
    .join("\n");
  fs.appendFileSync(
    stepSummaryPath,
    [
      "## Runner Pool Drift Detected",
      "",
      "Notification channel configured.",
      "",
      "| Pool | Desired | Actual | Drift | Status |",
      "| --- | ---: | ---: | ---: | --- |",
      rows,
      ""
    ].join("\n"),
    "utf8"
  );
}

async function renderComposeCommand(args: string[]): Promise<void> {
  const output = getOption(args, "--output");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const compose = renderCompose(config, env);

  if (output) {
    fs.writeFileSync(path.resolve(output), `${compose}\n`, "utf8");
    process.stdout.write(`${output}\n`);
    return;
  }

  process.stdout.write(`${compose}\n`);
}

async function validateGitHub(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);

  const matches = await verifyRunnerGroups(
    env.githubApiUrl,
    env.githubPat!,
    config.pools.map((pool) => ({
      poolKey: pool.key,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup
    }))
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        pools: matches
      },
      null,
      2
    )}\n`
  );
}

async function validateLinuxDockerConfig(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/linux-docker-runners.yaml");
  const config = loadLinuxDockerConfig(configPath!, env);

  process.stdout.write(
    `${JSON.stringify(
      {
        version: config.version,
        image: config.image,
        pools: config.pools.map((pool) => ({
          key: pool.key,
          runnerGroup: pool.runnerGroup,
          visibility: pool.visibility,
          labels: pool.labels,
          size: pool.size,
          architecture: pool.architecture,
          runnerRoot: pool.runnerRoot
        }))
      },
      null,
      2
    )}\n`
  );
}

async function validateLinuxDockerGitHub(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/linux-docker-runners.yaml");
  const config = loadLinuxDockerConfig(configPath!, env);
  const matches = await verifyRunnerGroups(
    env.githubApiUrl,
    env.githubPat!,
    config.pools.map((pool) => ({
      poolKey: pool.key,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup
    }))
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        pools: matches
      },
      null,
      2
    )}\n`
  );
}

async function validateWindowsDockerConfig(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/windows-runners.yaml");
  const config = loadWindowsDockerConfig(configPath!, env);

  process.stdout.write(
    `${JSON.stringify(
      {
        version: config.version,
        plane: config.plane,
        image: config.image,
        pools: config.pools.map((pool) => ({
          key: pool.key,
          runnerGroup: pool.runnerGroup,
          visibility: pool.visibility,
          labels: pool.labels,
          size: pool.size,
          host: pool.host,
          sshUser: pool.sshUser,
          runnerRoot: pool.runnerRoot,
          imageRef: pool.imageRef
        }))
      },
      null,
      2
    )}\n`
  );
}

async function validateWindowsDockerGitHub(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/windows-runners.yaml");
  const config = loadWindowsDockerConfig(configPath!, env);
  const matches = await verifyRunnerGroups(
    env.githubApiUrl,
    env.githubPat!,
    config.pools.map((pool) => ({
      poolKey: pool.key,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup
    }))
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        pools: matches
      },
      null,
      2
    )}\n`
  );
}

async function renderSynologyProjectManifest(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const compose = renderCompose(config, env);
  const plan = buildSynologyInstallPlan(config, env, compose, {
    allowIncomplete: true
  });

  process.stdout.write(
    `${JSON.stringify(summarizeSynologyInstallPlan(plan), null, 2)}\n`
  );
}

async function renderLinuxDockerComposeCommand(args: string[]): Promise<void> {
  const output = getOption(args, "--output");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/linux-docker-runners.yaml");
  const config = loadLinuxDockerConfig(configPath!, env);
  const compose = renderLinuxDockerCompose(config, env);

  if (output) {
    fs.writeFileSync(path.resolve(output), `${compose}\n`, "utf8");
    process.stdout.write(`${output}\n`);
    return;
  }

  process.stdout.write(`${compose}\n`);
}

async function renderLinuxDockerProjectManifest(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/linux-docker-runners.yaml");
  const config = loadLinuxDockerConfig(configPath!, env);
  const compose = renderLinuxDockerCompose(config, env);
  const plan = buildLinuxDockerInstallPlan(config, env, compose, {
    allowIncomplete: true
  });

  process.stdout.write(
    `${JSON.stringify(summarizeLinuxDockerInstallPlan(plan), null, 2)}\n`
  );
}

async function renderWindowsDockerComposeCommand(args: string[]): Promise<void> {
  const output = getOption(args, "--output");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/windows-runners.yaml");
  const config = loadWindowsDockerConfig(configPath!, env);
  const compose = renderWindowsDockerCompose(config, env);

  if (output) {
    fs.writeFileSync(path.resolve(output), `${compose}\n`, "utf8");
    process.stdout.write(`${output}\n`);
    return;
  }

  process.stdout.write(`${compose}\n`);
}

async function renderWindowsDockerProjectManifest(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/windows-runners.yaml");
  const config = loadWindowsDockerConfig(configPath!, env);
  const compose = renderWindowsDockerCompose(config, env);
  const plan = buildWindowsDockerInstallPlan(config, env, compose, {
    allowIncomplete: true
  });

  process.stdout.write(
    `${JSON.stringify(summarizeWindowsDockerInstallPlan(plan), null, 2)}\n`
  );
}

async function installSynologyProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const compose = renderCompose(config, env);
  const plan = buildSynologyInstallPlan(config, env, compose, {
    allowIncomplete: dryRun,
    action: "up"
  });

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(summarizeSynologyInstallPlan(plan), null, 2)}\n`
    );
    return;
  }

  const python = getOption(args, "--python", "python3")!;
  runSynologyInstallPlan(plan, python);
}

async function installLinuxDockerProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getOption(args, "--config", "config/linux-docker-runners.yaml");
  const config = loadLinuxDockerConfig(configPath!, env);
  const compose = renderLinuxDockerCompose(config, env);
  const plan = buildLinuxDockerInstallPlan(config, env, compose, {
    allowIncomplete: dryRun,
    action: "up"
  });

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(summarizeLinuxDockerInstallPlan(plan), null, 2)}\n`
    );
    return;
  }

  runLinuxDockerInstall(plan);
}

async function teardownSynologyProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const compose = renderCompose(config, env);
  const plan = buildSynologyInstallPlan(config, env, compose, {
    allowIncomplete: dryRun,
    action: "down"
  });

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(summarizeSynologyInstallPlan(plan), null, 2)}\n`
    );
    return;
  }

  await drainBeforeTeardown(args, env, [
    ...config.pools.map((pool) => ({
      plane: "synology" as const,
      key: pool.key,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup,
      runnerNames: buildIndexedRunnerNames(pool.key, 1, pool.size)
    }))
  ]);

  const python = getOption(args, "--python", "python3")!;
  runSynologyInstallPlan(plan, python);
}

function runSynologyInstallPlan(
  plan: ReturnType<typeof buildSynologyInstallPlan>,
  python: string
): void {
  const scriptPath = path.resolve("scripts/install-synology-project.py");
  const result = spawnSync(python, [scriptPath], {
    input: JSON.stringify(plan),
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    throw new Error(stderr || stdout || `installer exited with status ${result.status}`);
  }

  process.stdout.write(result.stdout);
}

async function teardownLinuxDockerProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getOption(args, "--config", "config/linux-docker-runners.yaml");
  const config = loadLinuxDockerConfig(configPath!, env);
  const compose = renderLinuxDockerCompose(config, env);
  const plan = buildLinuxDockerInstallPlan(config, env, compose, {
    allowIncomplete: dryRun,
    action: "down"
  });

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(summarizeLinuxDockerInstallPlan(plan), null, 2)}\n`
    );
    return;
  }

  await drainBeforeTeardown(args, env, [
    ...config.pools.map((pool) => ({
      plane: "linux-docker" as const,
      key: pool.key,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup,
      runnerNames: buildIndexedRunnerNames(pool.key, 1, pool.size)
    }))
  ]);

  runLinuxDockerInstall(plan);
}

async function installWindowsDockerProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getOption(args, "--config", "config/windows-runners.yaml");
  const config = loadWindowsDockerConfig(configPath!, env);
  const compose = renderWindowsDockerCompose(config, env);
  const plan = buildWindowsDockerInstallPlan(config, env, compose, {
    allowIncomplete: dryRun,
    action: "up"
  });

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(summarizeWindowsDockerInstallPlan(plan), null, 2)}\n`
    );
    return;
  }

  runWindowsDockerInstall(plan);
}

async function teardownWindowsDockerProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getOption(args, "--config", "config/windows-runners.yaml");
  const config = loadWindowsDockerConfig(configPath!, env);
  const compose = renderWindowsDockerCompose(config, env);
  const plan = buildWindowsDockerInstallPlan(config, env, compose, {
    allowIncomplete: dryRun,
    action: "down"
  });

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(summarizeWindowsDockerInstallPlan(plan), null, 2)}\n`
    );
    return;
  }

  await drainBeforeTeardown(args, env, [
    ...config.pools.map((pool) => ({
      plane: "windows-docker" as const,
      key: pool.key,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup,
      runnerNames: buildIndexedRunnerNames(pool.key, 1, pool.size)
    }))
  ]);

  runWindowsDockerInstall(plan);
}

async function validateImage(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const imageRef = `${config.image.repository}:${config.image.tag}`;

  const match = await verifyContainerImageTag(
    env.githubApiUrl,
    env.githubPat!,
    imageRef
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        image: match
      },
      null,
      2
    )}\n`
  );
}

async function checkRunnerVersion(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const currentVersion = getOption(args, "--current", env.runnerVersion) ?? env.runnerVersion;
  const release = await fetchLatestRunnerRelease(env.githubApiUrl, env.githubPat);
  const status = summarizeRunnerVersion(currentVersion, release.version);

  process.stdout.write(
    `${JSON.stringify(
      {
        ...status,
        publishedAt: release.publishedAt,
        htmlUrl: release.htmlUrl
      },
      null,
      2
    )}\n`
  );
}

async function runnerReleaseManifest(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const currentVersion = getOption(args, "--current", env.runnerVersion) ?? env.runnerVersion;
  const release = await fetchLatestRunnerRelease(env.githubApiUrl, env.githubPat);
  const status = summarizeRunnerVersion(currentVersion, release.version);

  process.stdout.write(
    `${JSON.stringify(
      {
        ...status,
        assets: {
          amd64: buildRunnerDownloadUrl(release.version, "amd64"),
          arm64: buildRunnerDownloadUrl(release.version, "arm64")
        }
      },
      null,
      2
    )}\n`
  );
}

async function validateLumeConfig(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/lume-runners.yaml");
  const config = loadLumeConfig(configPath!, env);

  process.stdout.write(
    `${JSON.stringify(
      {
        version: config.version,
        host: config.host,
        pool: {
          key: config.pool.key,
          organization: config.pool.organization,
          runnerGroup: config.pool.runnerGroup,
          labels: config.pool.labels,
          size: config.pool.size,
          vmBaseName: config.pool.vmBaseName,
          vmSlotPrefix: config.pool.vmSlotPrefix,
          runnerVersion: config.pool.runnerVersion
        },
        slots: config.slots.map((slot) => ({
          index: slot.index,
          slotKey: slot.slotKey,
          vmName: slot.vmName,
          runnerName: slot.runnerName
        }))
      },
      null,
      2
    )}\n`
  );
}

async function validateLumeGitHub(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: true
  });
  const configPath = getOption(args, "--config", "config/lume-runners.yaml");
  const config = loadLumeConfig(configPath!, env);
  const matches = await verifyRunnerGroups(
    env.githubApiUrl,
    env.githubPat!,
    [
      {
        poolKey: config.pool.key,
        organization: config.pool.organization,
        runnerGroup: config.pool.runnerGroup
      }
    ]
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        pools: matches
      },
      null,
      2
    )}\n`
  );
}

async function renderLumeRunnerManifest(args: string[]): Promise<void> {
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/lume-runners.yaml");
  const slot = getOption(args, "--slot");
  const format = getOption(args, "--format", "json");
  const config = loadLumeConfig(configPath!, env);

  if (format === "shell") {
    if (!slot) {
      throw new Error("--slot is required when --format shell is used");
    }

    process.stdout.write(renderLumeShellExports(config, Number(slot)));
    return;
  }

  if (slot) {
    const slotIndex = Number(slot);
    const manifest = config.slots.find((entry) => entry.index === slotIndex);
    if (!manifest) {
      throw new Error(`slot ${slotIndex} is outside configured pool size ${config.pool.size}`);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          host: config.host,
          pool: config.pool,
          slot: manifest
        },
        null,
        2
      )}\n`
    );
    return;
  }

  process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
}

async function installLumeProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const format = getLumeProjectFormat(args);
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getLumeConfigPath(args);
  const config = loadLumeConfig(configPath, env);
  const resultPath = getOption(
    args,
    "--status-output",
    defaultLumeProjectResultPath(config)
  )!;
  let status: LumeProjectResult["status"] = "dry-run";
  let supervisorPid: number | undefined;

  if (!dryRun) {
    const existingPid = readPidFile(defaultLumeProjectPidFile(config));
    if (existingPid && isProcessRunning(existingPid)) {
      status = "already-running";
      supervisorPid = existingPid;
    } else {
      supervisorPid = startLumeSupervisor(configPath, getOption(args, "--env", ".env")!, config);
      status = "started";
    }
  }

  const result = buildLumeProjectResult({
    action: "install",
    status,
    config,
    resultPath,
    supervisorPid
  });
  saveLumeProjectResult(result);
  writeLumeProjectResult(result, format);
}

async function teardownLumeProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const format = getLumeProjectFormat(args);
  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: !dryRun
  });
  const configPath = getLumeConfigPath(args);
  const config = loadLumeConfig(configPath, env);
  const resultPath = getOption(
    args,
    "--status-output",
    defaultLumeProjectResultPath(config)
  )!;
  let drain: LumeProjectResult["drain"];

  if (!dryRun) {
    const drainReport = await drainRunnerPool({
      apiUrl: env.githubApiUrl,
      token: env.githubPat!,
      organization: config.pool.organization,
      runnerGroup: config.pool.runnerGroup,
      poolKey: config.pool.key,
      runnerNames: config.slots.map((slot) => slot.runnerName),
      timeoutSeconds: parseDurationSeconds(
        getOption(args, "--drain-timeout", getOption(args, "--timeout", "300"))!,
        "--drain-timeout"
      ),
      intervalSeconds: parseDurationSeconds(
        getOption(args, "--drain-interval", getOption(args, "--interval", "5"))!,
        "--drain-interval"
      ),
      onProgress: (progress) => writeDrainProgress("lume", progress)
    });

    if (drainReport.status === "timeout") {
      throw new Error(
        `timed out waiting for ${drainReport.busy.join(", ")} to become idle before tearing down ${config.pool.key}`
      );
    }

    drain = {
      status: drainReport.status,
      cordoned: drainReport.cordoned,
      busy: drainReport.busy,
      missing: drainReport.missing
    };
    stopLumeSupervisor(config);
    for (const slot of config.slots) {
      stopLumeWorker(slot.workerPidFile);
      runLumeSlotTeardown(configPath, getOption(args, "--env", ".env")!, slot.index);
      fs.rmSync(slot.hostDir, { recursive: true, force: true });
    }
  }

  const result = buildLumeProjectResult({
    action: "teardown",
    status: dryRun ? "dry-run" : "stopped",
    config,
    resultPath,
    drain
  });
  saveLumeProjectResult(result);
  writeLumeProjectResult(result, format);
}

function getConfigAgeSeconds(configPath: string): number {
  const stats = fs.statSync(path.resolve(configPath));
  return Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000));
}

function applyAutoscaleDecisions(
  config: ResolvedConfig,
  decisions: AutoscaleDecision[]
): ResolvedConfig {
  const targetSizes = new Map(
    decisions
      .filter((decision) => decision.action !== "none")
      .map((decision) => [decision.poolKey, decision.targetSize])
  );

  return {
    ...config,
    pools: config.pools.map((pool) => ({
      ...pool,
      size: targetSizes.get(pool.key) ?? pool.size
    }))
  };
}

function writeScaledPoolSizes(
  configPath: string,
  decisions: AutoscaleDecision[]
): void {
  const targetSizes = new Map(
    decisions
      .filter((decision) => decision.action !== "none")
      .map((decision) => [decision.poolKey, decision.targetSize])
  );
  if (targetSizes.size === 0) {
    return;
  }

  const absolutePath = path.resolve(configPath);
  const document = YAML.parse(fs.readFileSync(absolutePath, "utf8")) as {
    pools?: Array<{ key?: string; size?: number }>;
  };
  if (!Array.isArray(document.pools)) {
    throw new Error(`config ${configPath} did not include pools`);
  }

  for (const pool of document.pools) {
    if (pool.key && targetSizes.has(pool.key)) {
      pool.size = targetSizes.get(pool.key);
    }
  }

  fs.writeFileSync(absolutePath, YAML.stringify(document), "utf8");
}

type DrainPlane = "synology" | "linux-docker" | "windows-docker" | "lume";

interface DrainPoolDefinition {
  plane: DrainPlane;
  key: string;
  organization: string;
  runnerGroup: string;
  runnerNames: string[];
}

async function drainBeforeTeardown(
  args: string[],
  env: ReturnType<typeof loadDeploymentEnv>,
  definitions: DrainPoolDefinition[]
): Promise<void> {
  if (!args.includes("--drain")) {
    return;
  }

  const timeoutSeconds = parseDurationSeconds(
    getOption(args, "--drain-timeout", getOption(args, "--timeout", "300"))!,
    "--drain-timeout"
  );
  const intervalSeconds = parseDurationSeconds(
    getOption(args, "--drain-interval", getOption(args, "--interval", "5"))!,
    "--drain-interval"
  );

  for (const definition of definitions) {
    const report = await drainRunnerPool({
      apiUrl: env.githubApiUrl,
      token: env.githubPat!,
      organization: definition.organization,
      runnerGroup: definition.runnerGroup,
      poolKey: definition.key,
      runnerNames: definition.runnerNames,
      timeoutSeconds,
      intervalSeconds,
      onProgress: (progress) => writeDrainProgress(definition.plane, progress)
    });

    if (report.status === "timeout") {
      throw new Error(
        `timed out waiting for ${report.busy.join(", ")} to become idle before tearing down ${definition.key}`
      );
    }
  }
}

function resolveDrainPoolDefinition(
  args: string[],
  env: ReturnType<typeof loadDeploymentEnv>,
  poolKey: string
): DrainPoolDefinition {
  const plane = getOption(args, "--plane") as DrainPlane | undefined;
  if (
    plane &&
    !["synology", "linux-docker", "windows-docker", "lume"].includes(plane)
  ) {
    throw new Error(`unknown drain plane: ${plane}`);
  }

  const matches = collectDrainPoolDefinitions(args, env, plane).filter(
    (definition) => definition.key === poolKey
  );
  if (matches.length === 0) {
    throw new Error(`unknown pool: ${poolKey}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `pool ${poolKey} exists in multiple planes; pass --plane to choose one`
    );
  }

  return matches[0];
}

function collectDrainPoolDefinitions(
  args: string[],
  env: ReturnType<typeof loadDeploymentEnv>,
  requestedPlane?: DrainPlane
): DrainPoolDefinition[] {
  const definitions: DrainPoolDefinition[] = [];

  if (shouldLoadDrainConfig(args, "--config", requestedPlane, "synology")) {
    const configPath = getOption(args, "--config", "config/pools.yaml")!;
    if (fs.existsSync(path.resolve(configPath))) {
      const config = loadConfig(configPath, env);
      definitions.push(
        ...config.pools.map((pool) => ({
          plane: "synology" as const,
          key: pool.key,
          organization: pool.organization,
          runnerGroup: pool.runnerGroup,
          runnerNames: buildIndexedRunnerNames(pool.key, 1, pool.size)
        }))
      );
    }
  }

  if (shouldLoadDrainConfig(args, "--linux-config", requestedPlane, "linux-docker")) {
    const configPath = getOption(
      args,
      "--linux-config",
      "config/linux-docker-runners.yaml"
    )!;
    if (fs.existsSync(path.resolve(configPath))) {
      const config = loadLinuxDockerConfig(configPath, env);
      definitions.push(
        ...config.pools.map((pool) => ({
          plane: "linux-docker" as const,
          key: pool.key,
          organization: pool.organization,
          runnerGroup: pool.runnerGroup,
          runnerNames: buildIndexedRunnerNames(pool.key, 1, pool.size)
        }))
      );
    }
  }

  if (shouldLoadDrainConfig(args, "--windows-config", requestedPlane, "windows-docker")) {
    const configPath = getOption(
      args,
      "--windows-config",
      "config/windows-runners.yaml"
    )!;
    if (fs.existsSync(path.resolve(configPath))) {
      const config = loadWindowsDockerConfig(configPath, env);
      definitions.push(
        ...config.pools.map((pool) => ({
          plane: "windows-docker" as const,
          key: pool.key,
          organization: pool.organization,
          runnerGroup: pool.runnerGroup,
          runnerNames: buildIndexedRunnerNames(pool.key, 1, pool.size)
        }))
      );
    }
  }

  if (shouldLoadDrainConfig(args, "--lume-config", requestedPlane, "lume")) {
    const configPath = getOption(args, "--lume-config", "config/lume-runners.yaml")!;
    if (fs.existsSync(path.resolve(configPath))) {
      const config = loadLumeConfig(configPath, env);
      definitions.push({
        plane: "lume",
        key: config.pool.key,
        organization: config.pool.organization,
        runnerGroup: config.pool.runnerGroup,
        runnerNames: config.slots.map((slot) => slot.runnerName)
      });
    }
  }

  return definitions;
}

function shouldLoadDrainConfig(
  args: string[],
  optionName: string,
  requestedPlane: DrainPlane | undefined,
  plane: DrainPlane
): boolean {
  if (args.includes(optionName)) {
    return true;
  }
  return !requestedPlane || requestedPlane === plane;
}

function buildIndexedRunnerNames(
  poolKey: string,
  startIndex: number,
  endIndex: number
): string[] {
  if (endIndex < startIndex) {
    return [];
  }
  return Array.from(
    { length: endIndex - startIndex + 1 },
    (_value, offset) =>
      `${poolKey}-runner-${String(startIndex + offset).padStart(2, "0")}`
  );
}

function writeDrainProgress(plane: DrainPlane, progress: DrainProgress): void {
  process.stderr.write(
    [
      `drain ${plane}/${progress.poolKey}:`,
      `${progress.status},`,
      `${progress.busy.length} busy,`,
      `${progress.cordoned.length} cordoned,`,
      `${progress.missing.length} already absent`
    ].join(" ") + "\n"
  );
}

function renderDrainReport(plane: DrainPlane, report: DrainReport): string {
  return [
    `drain ${plane}/${report.poolKey}: ${report.status}`,
    `cordoned: ${report.cordoned.length}/${report.total}`,
    `busy: ${report.busy.length ? report.busy.join(", ") : "none"}`,
    `already absent: ${report.missing.length ? report.missing.join(", ") : "none"}`,
    ""
  ].join("\n");
}

function getDoctorMode(args: string[]): DoctorMode {
  const optionFlags = new Set([
    "--env",
    "--config",
    "--lume-config",
    "--format"
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionFlags.has(arg)) {
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      continue;
    }

    if (arg === "full" || arg === "synology" || arg === "lume") {
      return arg;
    }

    throw new Error(`unknown doctor mode: ${arg}`);
  }

  return "full";
}

function getLumeConfigPath(args: string[]): string {
  return getOption(
    args,
    "--lume-config",
    getOption(args, "--config", "config/lume-runners.yaml")
  )!;
}

function getLumeProjectFormat(args: string[]): "json" | "text" {
  const format = getOption(args, "--format", "text")!;
  if (format !== "json" && format !== "text") {
    throw new Error(`unknown Lume project format: ${format}`);
  }
  return format;
}

function getOption(
  args: string[],
  flag: string,
  defaultValue?: string
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return defaultValue;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }

  return value;
}

function parseNonNegativeInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseDurationSeconds(value: string, optionName: string): number {
  const match = value.match(/^(\d+)([smh])?$/);
  if (!match) {
    throw new Error(`${optionName} must be a non-negative duration like 300, 15m, or 1h`);
  }

  const amount = parseNonNegativeInteger(match[1], optionName);
  const unit = match[2] ?? "s";
  if (unit === "h") {
    return amount * 60 * 60;
  }
  if (unit === "m") {
    return amount * 60;
  }
  return amount;
}

function runLinuxDockerInstall(
  plan: ReturnType<typeof buildLinuxDockerInstallPlan>
): void {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "linux-docker-install-"));
  const composePath = path.join(stagingDir, plan.project.composeFileName);
  const envPath = path.join(stagingDir, plan.project.envFileName);
  const scriptPath = path.join(stagingDir, plan.project.deploymentScriptName);
  const remote = `${plan.connection.username}@${plan.connection.host}`;

  try {
    fs.writeFileSync(composePath, `${plan.composeContent}\n`, "utf8");
    fs.writeFileSync(envPath, plan.envFileContent, "utf8");
    fs.writeFileSync(scriptPath, plan.deploymentScript, "utf8");

    runCommand(
      "ssh",
      [
        "-p",
        plan.connection.port,
        remote,
        [
          "mkdir -p",
          shellQuote(plan.project.directory),
          shellQuote(path.posix.join(plan.project.directory, "logs")),
          ...plan.stateDirectories.map((entry) => shellQuote(entry))
        ].join(" ")
      ],
      "failed to prepare remote Linux Docker host"
    );

    runCommand(
      "scp",
      [
        "-P",
        plan.connection.port,
        composePath,
        envPath,
        scriptPath,
        `${remote}:${shellEscapeRemotePath(plan.project.directory)}/`
      ],
      "failed to upload Linux Docker project files"
    );

    runCommand(
      "ssh",
      [
        "-p",
        plan.connection.port,
        remote,
        [
          "chmod 700",
          shellQuote(path.posix.join(plan.project.directory, plan.project.deploymentScriptName)),
          "&& cd",
          shellQuote(plan.project.directory),
          "&& ./" + plan.project.deploymentScriptName
        ].join(" ")
      ],
      "failed to execute Linux Docker deployment"
    );
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function runWindowsDockerInstall(
  plan: ReturnType<typeof buildWindowsDockerInstallPlan>
): void {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "windows-docker-install-"));
  const composePath = path.join(stagingDir, plan.project.composeFileName);
  const envPath = path.join(stagingDir, plan.project.envFileName);
  const scriptPath = path.join(stagingDir, plan.project.deploymentScriptName);
  const remote = `${plan.connection.username}@${plan.connection.host}`;
  const remoteProjectDir = windowsRemotePath(plan.project.directory);
  const remoteScriptPath = windowsRemotePath(
    path.win32.join(plan.project.directory, plan.project.deploymentScriptName)
  );

  try {
    fs.writeFileSync(composePath, `${plan.composeContent}\n`, "utf8");
    fs.writeFileSync(envPath, plan.envFileContent, "utf8");
    fs.writeFileSync(scriptPath, plan.deploymentScript, "utf8");

    runCommand(
      "ssh",
      [
        "-p",
        plan.connection.port,
        remote,
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `New-Item -ItemType Directory -Force -Path ${powerShellQuote(plan.project.directory)} | Out-Null`
      ],
      "failed to prepare remote Windows Docker host"
    );

    runCommand(
      "scp",
      [
        "-P",
        plan.connection.port,
        composePath,
        envPath,
        scriptPath,
        `${remote}:${remoteProjectDir}/`
      ],
      "failed to upload Windows Docker project files"
    );

    runCommand(
      "ssh",
      [
        "-p",
        plan.connection.port,
        remote,
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        remoteScriptPath
      ],
      "failed to execute Windows Docker deployment"
    );
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function startLumeSupervisor(
  configPath: string,
  envPath: string,
  config: ReturnType<typeof loadLumeConfig>
): number {
  const pidFile = defaultLumeProjectPidFile(config);
  const logFile = defaultLumeProjectLogFile(config);
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const output = fs.openSync(logFile, "a");
  const child = spawn(
    "bash",
    [
      path.resolve("scripts/lume/reconcile-pool.sh"),
      "--config",
      path.resolve(configPath),
      "--env",
      path.resolve(envPath)
    ],
    {
      detached: true,
      env: process.env,
      stdio: ["ignore", output, output]
    }
  );
  if (!child.pid) {
    fs.closeSync(output);
    throw new Error("failed to start Lume project supervisor");
  }
  child.unref();
  fs.closeSync(output);
  fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  return child.pid;
}

function stopLumeSupervisor(config: ReturnType<typeof loadLumeConfig>): void {
  const pidFile = defaultLumeProjectPidFile(config);
  const pid = readPidFile(pidFile);
  if (pid && isProcessRunning(pid)) {
    process.kill(pid, "SIGTERM");
  }
  fs.rmSync(pidFile, { force: true });
}

function stopLumeWorker(pidFile: string): void {
  const pid = readPidFile(pidFile);
  if (pid && isProcessRunning(pid)) {
    process.kill(pid, "SIGTERM");
  }
  fs.rmSync(pidFile, { force: true });
}

function runLumeSlotTeardown(
  configPath: string,
  envPath: string,
  slotIndex: number
): void {
  runCommand(
    "bash",
    [
      path.resolve("scripts/lume/destroy-slot.sh"),
      "--slot",
      String(slotIndex),
      "--config",
      path.resolve(configPath),
      "--env",
      path.resolve(envPath)
    ],
    `failed to tear down Lume slot ${slotIndex}`
  );
}

function readPidFile(pidFile: string): number | undefined {
  if (!fs.existsSync(pidFile)) {
    return undefined;
  }
  const parsed = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLumeProjectResult(
  result: LumeProjectResult,
  format: "json" | "text"
): void {
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatLumeProjectResultText(result)
  );
}

function runCommand(
  command: string,
  args: string[],
  errorPrefix: string
): void {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    throw new Error(
      `${errorPrefix}: ${stderr || stdout || `${command} exited with status ${result.status}`}`
    );
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shellEscapeRemotePath(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
}

function windowsRemotePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function printUsage(): void {
  process.stderr.write(`Usage:
  pnpm doctor [full|synology|lume] [--env .env] [--config config/pools.yaml] [--lume-config config/lume-runners.yaml] [--format text|json]
  pnpm audit-log [--file /var/log/runner-fleet/audit.jsonl] [--max-size-bytes 10485760] < event.json
  pnpm drift-detect [--config config/pools.yaml] [--env .env] [--threshold 0]
  pnpm drain-pool -- --pool synology-private [--plane synology|linux-docker|windows-docker|lume] [--env .env] [--config config/pools.yaml] [--linux-config config/linux-docker-runners.yaml] [--windows-config config/windows-runners.yaml] [--lume-config config/lume-runners.yaml] [--timeout 15m] [--interval 5] [--format text|json]
  pnpm scale [--config config/pools.yaml] [--env .env] [--pool synology-private] [--dry-run] [--drain-timeout 300] [--drain-interval 5] [--python python3]
  pnpm validate-config [--config config/pools.yaml] [--env .env]
  pnpm validate-linux-docker-config [--config config/linux-docker-runners.yaml] [--env .env]
  pnpm validate-linux-docker-github [--config config/linux-docker-runners.yaml] [--env .env]
  pnpm validate-windows-config [--config config/windows-runners.yaml] [--env .env]
  pnpm validate-windows-github [--config config/windows-runners.yaml] [--env .env]
  pnpm validate-github [--config config/pools.yaml] [--env .env]
  pnpm validate-image [--config config/pools.yaml] [--env .env]
  pnpm render-linux-docker-compose [--config config/linux-docker-runners.yaml] [--env .env] [--output docker-compose.linux-docker.yml]
  pnpm render-linux-docker-project-manifest [--config config/linux-docker-runners.yaml] [--env .env]
  pnpm render-windows-compose [--config config/windows-runners.yaml] [--env .env] [--output docker-compose.windows.yml]
  pnpm render-windows-project-manifest [--config config/windows-runners.yaml] [--env .env]
  pnpm render-compose [--config config/pools.yaml] [--env .env] [--output docker-compose.generated.yml]
  pnpm install-linux-docker-project [--config config/linux-docker-runners.yaml] [--env .env] [--dry-run]
  pnpm teardown-linux-docker-project [--config config/linux-docker-runners.yaml] [--env .env] [--dry-run] [--drain] [--drain-timeout 15m]
  pnpm install-windows-project [--config config/windows-runners.yaml] [--env .env] [--dry-run]
  pnpm teardown-windows-project [--config config/windows-runners.yaml] [--env .env] [--dry-run] [--drain] [--drain-timeout 15m]
  pnpm render-synology-project-manifest [--config config/pools.yaml] [--env .env]
  pnpm install-synology-project [--config config/pools.yaml] [--env .env] [--dry-run] [--python python3]
  pnpm teardown-synology-project [--config config/pools.yaml] [--env .env] [--dry-run] [--drain] [--drain-timeout 15m] [--python python3]
  pnpm check-runner-version [--current 2.333.0] [--env .env]
  pnpm runner-release-manifest [--current 2.333.0] [--env .env]
  pnpm validate-lume-config [--config config/lume-runners.yaml] [--env .env]
  pnpm validate-lume-github [--config config/lume-runners.yaml] [--env .env]
  pnpm render-lume-runner-manifest [--config config/lume-runners.yaml] [--env .env] [--slot 1] [--format json|shell]
  pnpm install-lume-project [--lume-config config/lume-runners.yaml] [--env .env] [--format text|json] [--status-output path] [--dry-run]
  pnpm teardown-lume-project [--lume-config config/lume-runners.yaml] [--env .env] [--format text|json] [--status-output path] [--drain-timeout 15m] [--dry-run]
`);
}

function emitWarnings(config: ReturnType<typeof loadConfig>): void {
  for (const warning of collectConfigWarnings(config)) {
    process.stderr.write(`warning: ${warning}\n`);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
