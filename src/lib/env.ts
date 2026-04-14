import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { normalizeRunnerVersion } from "./runner-version.js";

export interface DeploymentEnv {
  githubPat?: string;
  githubApiUrl: string;
  synologyRunnerBaseDir: string;
  synologyHost?: string;
  synologyPort: string;
  synologyUsername?: string;
  synologyPassword?: string;
  synologySecure: boolean;
  synologyCertVerify: boolean;
  synologyDsmVersion: number;
  synologyApiRepo: string;
  synologyProjectDir: string;
  synologyProjectComposeFile: string;
  synologyProjectEnvFile: string;
  synologyInstallPullImages: boolean;
  synologyInstallForceRecreate: boolean;
  synologyInstallRemoveOrphans: boolean;
  linuxDockerRunnerBaseDir: string;
  linuxDockerHost?: string;
  linuxDockerPort: string;
  linuxDockerUsername?: string;
  linuxDockerProjectDir: string;
  linuxDockerProjectComposeFile: string;
  linuxDockerProjectEnvFile: string;
  linuxDockerInstallPullImages: boolean;
  linuxDockerInstallForceRecreate: boolean;
  linuxDockerInstallRemoveOrphans: boolean;
  lumeRunnerBaseDir: string;
  lumeRunnerEnvFile: string;
  lumeRunnerIpswPath?: string;
  composeProjectName: string;
  runnerVersion: string;
  raw: Record<string, string>;
}

export interface LoadDeploymentEnvOptions {
  envPath?: string;
  requirePat?: boolean;
}

export function loadDeploymentEnv(
  options: LoadDeploymentEnvOptions = {}
): DeploymentEnv {
  const envPath = options.envPath ?? path.resolve(process.cwd(), ".env");
  const requirePat = options.requirePat ?? true;

  const fileEnv = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath, "utf8"))
    : {};

  const merged = {
    ...fileEnv,
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    )
  };

  const githubPat = merged.GITHUB_PAT?.trim() || undefined;
  if (requirePat && !githubPat) {
    throw new Error(
      `GITHUB_PAT is required; set it in ${envPath} or the current environment`
    );
  }

  const githubApiUrl = normalizeUrl(
    merged.GITHUB_API_URL || "https://api.github.com"
  );
  const synologyRunnerBaseDir =
    merged.SYNOLOGY_RUNNER_BASE_DIR ||
    "/volume1/docker/github-runner-fleet";
  const synologySecure = parseBoolean(merged.SYNOLOGY_SECURE, true);
  const synologyPort =
    merged.SYNOLOGY_PORT || (synologySecure ? "5001" : "5000");
  const synologyCertVerify = parseBoolean(
    merged.SYNOLOGY_CERT_VERIFY,
    false
  );
  const synologyDsmVersion = parseInteger(merged.SYNOLOGY_DSM_VERSION, 7);
  const synologyApiRepo = expandHome(
    merged.SYNOLOGY_API_REPO || "~/src/synology-api"
  );
  const synologyProjectDir =
    merged.SYNOLOGY_PROJECT_DIR || synologyRunnerBaseDir;
  const synologyProjectComposeFile =
    merged.SYNOLOGY_PROJECT_COMPOSE_FILE || "compose.yaml";
  const synologyProjectEnvFile =
    merged.SYNOLOGY_PROJECT_ENV_FILE || ".env";
  const synologyInstallPullImages = parseBoolean(
    merged.SYNOLOGY_INSTALL_PULL_IMAGES,
    true
  );
  const synologyInstallForceRecreate = parseBoolean(
    merged.SYNOLOGY_INSTALL_FORCE_RECREATE,
    true
  );
  const synologyInstallRemoveOrphans = parseBoolean(
    merged.SYNOLOGY_INSTALL_REMOVE_ORPHANS,
    true
  );
  const linuxDockerRunnerBaseDir = expandHome(
    merged.LINUX_DOCKER_RUNNER_BASE_DIR ||
      "/srv/github-runner-fleet/linux-docker"
  );
  const linuxDockerPort = merged.LINUX_DOCKER_PORT || "22";
  const linuxDockerProjectDir =
    expandHome(merged.LINUX_DOCKER_PROJECT_DIR || linuxDockerRunnerBaseDir);
  const linuxDockerProjectComposeFile =
    merged.LINUX_DOCKER_PROJECT_COMPOSE_FILE || "compose.yaml";
  const linuxDockerProjectEnvFile =
    merged.LINUX_DOCKER_PROJECT_ENV_FILE || ".env";
  const linuxDockerInstallPullImages = parseBoolean(
    merged.LINUX_DOCKER_INSTALL_PULL_IMAGES,
    true
  );
  const linuxDockerInstallForceRecreate = parseBoolean(
    merged.LINUX_DOCKER_INSTALL_FORCE_RECREATE,
    true
  );
  const linuxDockerInstallRemoveOrphans = parseBoolean(
    merged.LINUX_DOCKER_INSTALL_REMOVE_ORPHANS,
    true
  );
  const lumeRunnerBaseDir = expandHome(
    merged.LUME_RUNNER_BASE_DIR ||
      "~/Library/Application Support/github-runner-fleet/lume"
  );
  const lumeRunnerEnvFile = expandHome(
    merged.LUME_RUNNER_ENV_FILE ||
      path.join(lumeRunnerBaseDir, "runner.env")
  );
  const lumeRunnerIpswPath = merged.LUME_RUNNER_IPSW_PATH?.trim()
    ? expandHome(merged.LUME_RUNNER_IPSW_PATH)
    : undefined;
  const composeProjectName =
    merged.COMPOSE_PROJECT_NAME || "github-runner-fleet";
  const runnerVersion = normalizeRunnerVersion(merged.RUNNER_VERSION || "2.333.0");

  return {
    githubPat,
    githubApiUrl,
    synologyRunnerBaseDir,
    synologyHost: merged.SYNOLOGY_HOST?.trim() || undefined,
    synologyPort,
    synologyUsername: merged.SYNOLOGY_USERNAME?.trim() || undefined,
    synologyPassword: merged.SYNOLOGY_PASSWORD?.trim() || undefined,
    synologySecure,
    synologyCertVerify,
    synologyDsmVersion,
    synologyApiRepo,
    synologyProjectDir,
    synologyProjectComposeFile,
    synologyProjectEnvFile,
    synologyInstallPullImages,
    synologyInstallForceRecreate,
    synologyInstallRemoveOrphans,
    linuxDockerRunnerBaseDir,
    linuxDockerHost: merged.LINUX_DOCKER_HOST?.trim() || undefined,
    linuxDockerPort,
    linuxDockerUsername: merged.LINUX_DOCKER_USERNAME?.trim() || undefined,
    linuxDockerProjectDir,
    linuxDockerProjectComposeFile,
    linuxDockerProjectEnvFile,
    linuxDockerInstallPullImages,
    linuxDockerInstallForceRecreate,
    linuxDockerInstallRemoveOrphans,
    lumeRunnerBaseDir,
    lumeRunnerEnvFile,
    lumeRunnerIpswPath,
    composeProjectName,
    runnerVersion,
    raw: {
      ...merged,
      GITHUB_API_URL: githubApiUrl,
      SYNOLOGY_RUNNER_BASE_DIR: synologyRunnerBaseDir,
      SYNOLOGY_PORT: synologyPort,
      SYNOLOGY_SECURE: String(synologySecure),
      SYNOLOGY_CERT_VERIFY: String(synologyCertVerify),
      SYNOLOGY_DSM_VERSION: String(synologyDsmVersion),
      SYNOLOGY_API_REPO: synologyApiRepo,
      SYNOLOGY_PROJECT_DIR: synologyProjectDir,
      SYNOLOGY_PROJECT_COMPOSE_FILE: synologyProjectComposeFile,
      SYNOLOGY_PROJECT_ENV_FILE: synologyProjectEnvFile,
      SYNOLOGY_INSTALL_PULL_IMAGES: String(synologyInstallPullImages),
      SYNOLOGY_INSTALL_FORCE_RECREATE: String(synologyInstallForceRecreate),
      SYNOLOGY_INSTALL_REMOVE_ORPHANS: String(synologyInstallRemoveOrphans),
      LINUX_DOCKER_RUNNER_BASE_DIR: linuxDockerRunnerBaseDir,
      LINUX_DOCKER_PORT: linuxDockerPort,
      LINUX_DOCKER_PROJECT_DIR: linuxDockerProjectDir,
      LINUX_DOCKER_PROJECT_COMPOSE_FILE: linuxDockerProjectComposeFile,
      LINUX_DOCKER_PROJECT_ENV_FILE: linuxDockerProjectEnvFile,
      LINUX_DOCKER_INSTALL_PULL_IMAGES: String(linuxDockerInstallPullImages),
      LINUX_DOCKER_INSTALL_FORCE_RECREATE: String(
        linuxDockerInstallForceRecreate
      ),
      LINUX_DOCKER_INSTALL_REMOVE_ORPHANS: String(
        linuxDockerInstallRemoveOrphans
      ),
      ...(merged.LINUX_DOCKER_HOST?.trim()
        ? { LINUX_DOCKER_HOST: merged.LINUX_DOCKER_HOST.trim() }
        : {}),
      ...(merged.LINUX_DOCKER_USERNAME?.trim()
        ? { LINUX_DOCKER_USERNAME: merged.LINUX_DOCKER_USERNAME.trim() }
        : {}),
      LUME_RUNNER_BASE_DIR: lumeRunnerBaseDir,
      LUME_RUNNER_ENV_FILE: lumeRunnerEnvFile,
      ...(lumeRunnerIpswPath
        ? { LUME_RUNNER_IPSW_PATH: lumeRunnerIpswPath }
        : {}),
      COMPOSE_PROJECT_NAME: composeProjectName,
      RUNNER_VERSION: runnerVersion
    }
  };
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`invalid boolean value "${value}"`);
}

function parseInteger(
  value: string | undefined,
  defaultValue: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid integer value "${value}"`);
  }

  return parsed;
}
