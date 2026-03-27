import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./lib/config.js";
import { renderCompose } from "./lib/compose.js";
import { loadDeploymentEnv } from "./lib/env.js";
import { fetchLatestRunnerRelease } from "./lib/github.js";
import {
  buildRunnerDownloadUrl,
  summarizeRunnerVersion
} from "./lib/runner-version.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "validate-config":
      await validateConfig(args);
      break;
    case "render-compose":
      await renderComposeCommand(args);
      break;
    case "check-runner-version":
      await checkRunnerVersion(args);
      break;
    case "runner-release-manifest":
      await runnerReleaseManifest(args);
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
  const compose = renderCompose(config, env);

  if (output) {
    fs.writeFileSync(path.resolve(output), `${compose}\n`, "utf8");
    process.stdout.write(`${output}\n`);
    return;
  }

  process.stdout.write(`${compose}\n`);
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
  pnpm render-compose [--config config/pools.yaml] [--env .env] [--output docker-compose.generated.yml]
  pnpm check-runner-version [--current 2.333.0] [--env .env]
  pnpm runner-release-manifest [--current 2.333.0] [--env .env]
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
