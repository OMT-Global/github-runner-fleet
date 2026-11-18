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

const DEFAULT_RUNNER_CHECKSUMS_FILE = fileURLToPath(
  new URL("../../.runner-checksums", import.meta.url)
);

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Every Actions Runner release asset the fleet deploys: the Linux image
 * (amd64/arm64), the Lume macOS guest (osx-arm64) and the Windows image.
 */
export function deployedRunnerAssetNames(version: string): string[] {
  const normalized = normalizeRunnerVersion(version);
  return [
    `actions-runner-linux-x64-${normalized}.tar.gz`,
    `actions-runner-linux-arm64-${normalized}.tar.gz`,
    `actions-runner-osx-arm64-${normalized}.tar.gz`,
    `actions-runner-win-x64-${normalized}.zip`
  ];
}

export function parseRunnerChecksums(text: string, source = ".runner-checksums"): Map<string, string> {
  const checksums = new Map<string, string>();
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }
    const match = /^([0-9a-fA-F]{64}) {2}(\S+)$/.exec(line);
    if (!match) {
      throw new Error(`${source}:${index + 1} is not a "<sha256>  <asset>" line`);
    }
    const digest = match[1].toLowerCase();
    const asset = match[2];
    const existing = checksums.get(asset);
    if (existing && existing !== digest) {
      throw new Error(`${source}:${index + 1} lists a conflicting digest for ${asset}`);
    }
    checksums.set(asset, digest);
  });
  return checksums;
}

export function readRunnerChecksums(
  filePath = DEFAULT_RUNNER_CHECKSUMS_FILE
): Map<string, string> {
  return parseRunnerChecksums(fs.readFileSync(filePath, "utf8"), filePath);
}

export function missingRunnerChecksums(
  version: string,
  checksums: Map<string, string>
): string[] {
  return deployedRunnerAssetNames(version).filter((asset) => !checksums.has(asset));
}

/**
 * Normalizes a GitHub release-asset `digest` ("sha256:<hex>") to bare hex.
 * Returns undefined when the digest is absent or not SHA-256.
 */
export function releaseAssetSha256(digest: string | undefined): string | undefined {
  if (!digest?.startsWith("sha256:")) {
    return undefined;
  }
  const hex = digest.slice("sha256:".length).toLowerCase();
  return SHA256_PATTERN.test(hex) ? hex : undefined;
}

export function formatRunnerChecksums(
  version: string,
  assets: Array<{ name: string; digest?: string }>
): string {
  const byName = new Map(assets.map((asset) => [asset.name, releaseAssetSha256(asset.digest)]));
  const lines = deployedRunnerAssetNames(version).map((name) => {
    const digest = byName.get(name);
    if (!digest) {
      throw new Error(`release v${normalizeRunnerVersion(version)} has no SHA-256 digest for ${name}`);
    }
    return `${digest}  ${name}`;
  });
  return `${lines.join("\n")}\n`;
}
