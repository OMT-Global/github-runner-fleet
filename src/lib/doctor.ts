import type { DeploymentEnv } from "./env.js";
import { loadConfig } from "./config.js";
import { loadLumeConfig } from "./lume-config.js";
import {
  fetchLatestRunnerRelease,
  type FetchLike,
  verifyContainerImageTag,
  verifyRunnerGroups
} from "./github.js";

export type DoctorMode = "synology" | "lume" | "all";

export interface DoctorOptions {
  mode: DoctorMode;
  env: DeploymentEnv;
  synologyConfigPath?: string;
  lumeConfigPath?: string;
  fetchImpl?: FetchLike;
}

export interface DoctorCheck {
  key: string;
  ok: boolean;
  summary: string;
  detail?: unknown;
}

export interface DoctorSection {
  key: "synology" | "lume" | "shared";
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorReport {
  ok: boolean;
  mode: DoctorMode;
  sections: DoctorSection[];
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const fetchImpl = options.fetchImpl;
  const sections: DoctorSection[] = [];

  if (options.mode === "synology" || options.mode === "all") {
    sections.push(
      await buildSynologySection(
        options.env,
        options.synologyConfigPath ?? "config/pools.yaml",
        fetchImpl
      )
    );
  }

  if (options.mode === "lume" || options.mode === "all") {
    sections.push(
      await buildLumeSection(
        options.env,
        options.lumeConfigPath ?? "config/lume-runners.yaml",
        fetchImpl
      )
    );
  }

  if (options.mode === "all") {
    sections.unshift(await buildSharedSection(options.env, fetchImpl));
  }

  return {
    ok: sections.every((section) => section.ok),
    mode: options.mode,
    sections
  };
}

export function formatDoctorText(report: DoctorReport): string {
  const lines = [`doctor mode=${report.mode} ok=${report.ok ? "true" : "false"}`];

  for (const section of report.sections) {
    lines.push(`${section.key}: ${section.ok ? "ok" : "failed"}`);
    for (const check of section.checks) {
      lines.push(`- [${check.ok ? "ok" : "fail"}] ${check.key}: ${check.summary}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function buildSharedSection(
  env: DeploymentEnv,
  fetchImpl?: FetchLike
): Promise<DoctorSection> {
  const checks: DoctorCheck[] = [];
  const hasPat = Boolean(env.githubPat);
  checks.push({
    key: "github_pat",
    ok: hasPat,
    summary: hasPat ? "GITHUB_PAT is configured" : "GITHUB_PAT is missing"
  });

  if (hasPat) {
    try {
      const release = await fetchLatestRunnerRelease(
        env.githubApiUrl,
        env.githubPat,
        fetchImpl
      );
      checks.push({
        key: "runner_release",
        ok: true,
        summary: `latest actions/runner release is ${release.version}`,
        detail: release
      });
    } catch (error) {
      checks.push({
        key: "runner_release",
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return finalizeSection("shared", checks);
}

async function buildSynologySection(
  env: DeploymentEnv,
  configPath: string,
  fetchImpl?: FetchLike
): Promise<DoctorSection> {
  const checks: DoctorCheck[] = [];

  try {
    const config = loadConfig(configPath, env);
    checks.push({
      key: "config",
      ok: true,
      summary: `loaded ${config.pools.length} Synology pool(s)`
    });

    checks.push({
      key: "synology_host",
      ok: Boolean(env.synologyHost),
      summary: env.synologyHost
        ? `SYNOLOGY_HOST=${env.synologyHost}`
        : "SYNOLOGY_HOST is missing"
    });

    if (!env.githubPat) {
      checks.push({
        key: "github_runner_groups",
        ok: false,
        summary: "GITHUB_PAT is required for GitHub runner group validation"
      });
      checks.push({
        key: "image_tag",
        ok: false,
        summary: "GITHUB_PAT is required for GHCR image tag validation"
      });
      return finalizeSection("synology", checks);
    }

    try {
      const groups = await verifyRunnerGroups(
        env.githubApiUrl,
        env.githubPat,
        config.pools.map((pool) => ({
          poolKey: pool.key,
          organization: pool.organization,
          runnerGroup: pool.runnerGroup
        })),
        fetchImpl
      );
      checks.push({
        key: "github_runner_groups",
        ok: true,
        summary: `verified ${groups.length} Synology runner group mapping(s)`
      });
    } catch (error) {
      checks.push({
        key: "github_runner_groups",
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const image = await verifyContainerImageTag(
        env.githubApiUrl,
        env.githubPat,
        `${config.image.repository}:${config.image.tag}`,
        fetchImpl
      );
      checks.push({
        key: "image_tag",
        ok: true,
        summary: `verified image tag ${image.imageRef}`,
        detail: image
      });
    } catch (error) {
      checks.push({
        key: "image_tag",
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      });
    }
  } catch (error) {
    checks.push({
      key: "config",
      ok: false,
      summary: error instanceof Error ? error.message : String(error)
    });
  }

  return finalizeSection("synology", checks);
}

async function buildLumeSection(
  env: DeploymentEnv,
  configPath: string,
  fetchImpl?: FetchLike
): Promise<DoctorSection> {
  const checks: DoctorCheck[] = [];

  try {
    const config = loadLumeConfig(configPath, env);
    checks.push({
      key: "config",
      ok: true,
      summary: `loaded Lume pool ${config.pool.key} with ${config.pool.size} slot(s)`
    });
    checks.push({
      key: "lume_env_file",
      ok: true,
      summary: `LUME_RUNNER_ENV_FILE=${env.lumeRunnerEnvFile}`
    });

    if (!env.githubPat) {
      checks.push({
        key: "github_runner_group",
        ok: false,
        summary: "GITHUB_PAT is required for GitHub runner group validation"
      });
      return finalizeSection("lume", checks);
    }

    try {
      const groups = await verifyRunnerGroups(
        env.githubApiUrl,
        env.githubPat,
        [
          {
            poolKey: config.pool.key,
            organization: config.pool.organization,
            runnerGroup: config.pool.runnerGroup
          }
        ],
        fetchImpl
      );
      checks.push({
        key: "github_runner_group",
        ok: true,
        summary: `verified Lume runner group ${groups[0]?.runnerGroup ?? config.pool.runnerGroup}`
      });
    } catch (error) {
      checks.push({
        key: "github_runner_group",
        ok: false,
        summary: error instanceof Error ? error.message : String(error)
      });
    }
  } catch (error) {
    checks.push({
      key: "config",
      ok: false,
      summary: error instanceof Error ? error.message : String(error)
    });
  }

  return finalizeSection("lume", checks);
}

function finalizeSection(
  key: DoctorSection["key"],
  checks: DoctorCheck[]
): DoctorSection {
  return {
    key,
    ok: checks.every((check) => check.ok),
    checks
  };
}
