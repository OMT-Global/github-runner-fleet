import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { decideAutoscale, type AutoscaleDecision } from "./lib/autoscale.js";
import { collectConfigWarnings, loadConfig, type ResolvedConfig } from "./lib/config.js";
import { renderCompose } from "./lib/compose.js";
import { loadDeploymentEnv } from "./lib/env.js";
import { loadLinuxDockerConfig } from "./lib/linux-docker-config.js";
import {
  buildLinuxDockerInstallPlan,
  summarizeLinuxDockerInstallPlan
} from "./lib/linux-docker-install.js";
import { renderLinuxDockerCompose } from "./lib/linux-docker-compose.js";
import {
  loadLumeConfig,
  renderLumeShellExports
} from "./lib/lume-config.js";
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
    case "scale":
      await scaleCommand(args);
      break;
    case "validate-linux-docker-config":
      await validateLinuxDockerConfig(args);
      break;
    case "validate-linux-docker-github":
      await validateLinuxDockerGitHub(args);
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

  const drainTimeoutSeconds = parseNonNegativeInteger(
    getOption(args, "--drain-timeout", "300")!,
    "--drain-timeout"
  );
  const drainIntervalSeconds = parseNonNegativeInteger(
    getOption(args, "--drain-interval", "5")!,
    "--drain-interval"
  );

  for (const decision of decisions.filter(
    (entry) => entry.action === "scale-down"
  )) {
    const pool = config.pools.find((entry) => entry.key === decision.poolKey)!;
    await waitForSynologyPoolDrain({
      apiUrl: env.githubApiUrl,
      token: env.githubPat!,
      organization: pool.organization,
      runnerGroup: pool.runnerGroup,
      poolKey: pool.key,
      targetSize: decision.targetSize,
      timeoutSeconds: drainTimeoutSeconds,
      intervalSeconds: drainIntervalSeconds
    });
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

  runLinuxDockerInstall(plan);
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

async function waitForSynologyPoolDrain(options: {
  apiUrl: string;
  token: string;
  organization: string;
  runnerGroup: string;
  poolKey: string;
  targetSize: number;
  timeoutSeconds: number;
  intervalSeconds: number;
}): Promise<void> {
  const deadline = Date.now() + options.timeoutSeconds * 1000;

  while (true) {
    const busyRunnerNames = await getBusyRunnersAboveTarget(options);
    if (busyRunnerNames.length === 0) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `timed out waiting for ${busyRunnerNames.join(", ")} to become idle before scaling ${options.poolKey} down`
      );
    }

    await sleep(options.intervalSeconds * 1000);
  }
}

async function getBusyRunnersAboveTarget(options: {
  apiUrl: string;
  token: string;
  organization: string;
  runnerGroup: string;
  poolKey: string;
  targetSize: number;
}): Promise<string[]> {
  const groups = await fetchOrganizationRunnerGroups(
    options.apiUrl,
    options.organization,
    options.token
  );
  const group = groups.find((entry) => entry.name === options.runnerGroup);
  if (!group) {
    throw new Error(
      `runner group ${options.runnerGroup} was not found in ${options.organization}`
    );
  }

  const runners = await fetchOrganizationRunners(
    options.apiUrl,
    options.organization,
    options.token
  );

  return runners
    .filter((runner) => runner.runnerGroupId === group.id && runner.busy)
    .filter((runner) => {
      const match = runner.name.match(/-runner-(\d+)$/);
      return match ? Number(match[1]) > options.targetSize : true;
    })
    .map((runner) => runner.name);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function printUsage(): void {
  process.stderr.write(`Usage:
  pnpm doctor [full|synology|lume] [--env .env] [--config config/pools.yaml] [--lume-config config/lume-runners.yaml] [--format text|json]
  pnpm drift-detect [--config config/pools.yaml] [--env .env] [--threshold 0]
  pnpm scale [--config config/pools.yaml] [--env .env] [--pool synology-private] [--dry-run] [--drain-timeout 300] [--drain-interval 5] [--python python3]
  pnpm validate-config [--config config/pools.yaml] [--env .env]
  pnpm validate-linux-docker-config [--config config/linux-docker-runners.yaml] [--env .env]
  pnpm validate-linux-docker-github [--config config/linux-docker-runners.yaml] [--env .env]
  pnpm validate-github [--config config/pools.yaml] [--env .env]
  pnpm validate-image [--config config/pools.yaml] [--env .env]
  pnpm render-linux-docker-compose [--config config/linux-docker-runners.yaml] [--env .env] [--output docker-compose.linux-docker.yml]
  pnpm render-linux-docker-project-manifest [--config config/linux-docker-runners.yaml] [--env .env]
  pnpm render-compose [--config config/pools.yaml] [--env .env] [--output docker-compose.generated.yml]
  pnpm install-linux-docker-project [--config config/linux-docker-runners.yaml] [--env .env] [--dry-run]
  pnpm teardown-linux-docker-project [--config config/linux-docker-runners.yaml] [--env .env] [--dry-run]
  pnpm render-synology-project-manifest [--config config/pools.yaml] [--env .env]
  pnpm install-synology-project [--config config/pools.yaml] [--env .env] [--dry-run] [--python python3]
  pnpm teardown-synology-project [--config config/pools.yaml] [--env .env] [--dry-run] [--python python3]
  pnpm check-runner-version [--current 2.333.0] [--env .env]
  pnpm runner-release-manifest [--current 2.333.0] [--env .env]
  pnpm validate-lume-config [--config config/lume-runners.yaml] [--env .env]
  pnpm validate-lume-github [--config config/lume-runners.yaml] [--env .env]
  pnpm render-lume-runner-manifest [--config config/lume-runners.yaml] [--env .env] [--slot 1] [--format json|shell]
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
