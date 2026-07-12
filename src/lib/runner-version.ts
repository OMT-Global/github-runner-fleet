import fs from "node:fs";
import { fileURLToPath } from "node:url";

export type RunnerArchitecture = "amd64" | "arm64";

const DEFAULT_RUNNER_VERSION_FILE = fileURLToPath(
  new URL("../../.runner-version", import.meta.url)
);

const RUNNER_ARCH_TO_ASSET: Record<RunnerArchitecture, string> = {
  amd64: "x64",
  arm64: "arm64"
};

export interface RunnerVersionStatus {
  current: string;
  latest: string;
  outdated: boolean;
}

export function normalizeRunnerVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function readCanonicalRunnerVersion(
  filePath = DEFAULT_RUNNER_VERSION_FILE
): string {
  const version = normalizeRunnerVersion(fs.readFileSync(filePath, "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid canonical runner version in ${filePath}: ${version}`);
  }
  return version;
}

export function runnerReleaseAgeDays(
  publishedAt: string | undefined,
  now = new Date()
): number | undefined {
  if (!publishedAt) {
    return undefined;
  }
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) {
    throw new Error(`invalid runner release published_at: ${publishedAt}`);
  }
  return Math.max(
    0,
    Math.floor((now.getTime() - published.getTime()) / (24 * 60 * 60 * 1000))
  );
}

export function compareRunnerVersions(a: string, b: string): number {
  const aParts = normalizeRunnerVersion(a).split(".").map(Number);
  const bParts = normalizeRunnerVersion(b).split(".").map(Number);
  const length = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < length; index += 1) {
    const aValue = aParts[index] ?? 0;
    const bValue = bParts[index] ?? 0;
    if (aValue !== bValue) {
      return aValue > bValue ? 1 : -1;
    }
  }

  return 0;
}

export function buildRunnerAssetName(
  version: string,
  architecture: RunnerArchitecture
): string {
  const normalizedVersion = normalizeRunnerVersion(version);
  const assetArch = RUNNER_ARCH_TO_ASSET[architecture];
  return `actions-runner-linux-${assetArch}-${normalizedVersion}.tar.gz`;
}

export function buildRunnerDownloadUrl(
  version: string,
  architecture: RunnerArchitecture
): string {
  const normalizedVersion = normalizeRunnerVersion(version);
  return `https://github.com/actions/runner/releases/download/v${normalizedVersion}/${buildRunnerAssetName(
    normalizedVersion,
    architecture
  )}`;
}

export function summarizeRunnerVersion(
  current: string,
  latest: string
): RunnerVersionStatus {
  const normalizedCurrent = normalizeRunnerVersion(current);
  const normalizedLatest = normalizeRunnerVersion(latest);
  return {
    current: normalizedCurrent,
    latest: normalizedLatest,
    outdated: compareRunnerVersions(normalizedCurrent, normalizedLatest) < 0
  };
}
