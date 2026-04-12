import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectConfigWarnings, loadConfig } from "./lib/config.js";
import { renderCompose } from "./lib/compose.js";
import { loadDeploymentEnv } from "./lib/env.js";
import {
  loadLumeConfig,
  renderLumeShellExports
} from "./lib/lume-config.js";
import {
  fetchLatestRunnerRelease,
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
import {
  buildSynologyStatusReport,
  formatSynologyStatusText,
  saveSynologyResult
} from "./lib/synology-status.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "validate-config":
      await validateConfig(args);
      break;
    case "validate-github":
      await validateGitHub(args);
      break;
    case "validate-image":
      await validateImage(args);
      break;
    case "render-compose":
      await renderComposeCommand(args);
      break;
    case "render-synology-project-manifest":
      await renderSynologyProjectManifest(args);
      break;
    case "install-synology-project":
      await installSynologyProject(args);
      break;
    case "teardown-synology-project":
      await teardownSynologyProject(args);
      break;
    case "synology-status":
      await synologyStatus(args);
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
          architecture: pool.architecture,
          runnerRoot: pool.runnerRoot
        }))
      },
      null,
      2
    )
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

async function installSynologyProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const statusOutput = getOption(args, "--status-output", ".tmp/synology-status.json");
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

  saveSynologyResult(statusOutput!, "up", result.stdout);
  process.stdout.write(result.stdout);
}

async function teardownSynologyProject(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const statusOutput = getOption(args, "--status-output", ".tmp/synology-status.json");
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

  saveSynologyResult(statusOutput!, "down", result.stdout);
  process.stdout.write(result.stdout);
}

async function synologyStatus(args: string[]): Promise<void> {
  const format = getOption(args, "--format", "text");
  if (!["text", "json"].includes(format!)) {
    throw new Error(`synology-status format must be text or json; received ${format}`);
  }

  const env = loadDeploymentEnv({
    envPath: getOption(args, "--env", ".env"),
    requirePat: false
  });
  const configPath = getOption(args, "--config", "config/pools.yaml");
  const config = loadConfig(configPath!, env);
  emitWarnings(config);
  const compose = renderCompose(config, env);
  const report = buildSynologyStatusReport({
    config,
    env,
    composeContent: compose,
    savedResultPath: getOption(args, "--result", ".tmp/synology-status.json")
  });

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatSynologyStatusText(report));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
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

function printUsage(): void {
  process.stderr.write(`Usage:
  pnpm validate-config [--config config/pools.yaml] [--env .env]
  pnpm validate-github [--config config/pools.yaml] [--env .env]
  pnpm validate-image [--config config/pools.yaml] [--env .env]
  pnpm render-compose [--config config/pools.yaml] [--env .env] [--output docker-compose.generated.yml]
  pnpm render-synology-project-manifest [--config config/pools.yaml] [--env .env]
  pnpm install-synology-project [--config config/pools.yaml] [--env .env] [--dry-run] [--python python3] [--status-output .tmp/synology-status.json]
  pnpm teardown-synology-project [--config config/pools.yaml] [--env .env] [--dry-run] [--python python3] [--status-output .tmp/synology-status.json]
  pnpm synology-status [--config config/pools.yaml] [--env .env] [--result .tmp/synology-status.json] [--format text|json]
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
