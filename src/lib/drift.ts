import type { PoolConfig } from "./config.js";
import {
  fetchOrganizationRunnerGroups,
  fetchOrganizationRunners,
  type FetchLike
} from "./github.js";

export type DriftStatus = "ok" | "under-provisioned" | "over-provisioned";

export interface DesiredPoolState {
  name: string;
  organization: string;
  runnerGroup: string;
  desired: number;
}

export interface ActualPoolState {
  name: string;
  actual: number;
}

export interface PoolDrift {
  name: string;
  desired: number;
  actual: number;
  drift: number;
  status: DriftStatus;
}

export interface DriftReport {
  pools: PoolDrift[];
  drifted: boolean;
}

export interface DesiredRunnerState {
  plane: string;
  poolKey: string;
  organization: string;
  name: string;
  runnerGroup: string;
  labels: string[];
}

export interface ActualRunnerState {
  id: number;
  organization: string;
  name: string;
  runnerGroup?: string;
  labels: string[];
  status: string;
}

export interface RunnerDiffEntry {
  organization: string;
  name: string;
  plane: string;
  poolKey: string;
  runnerGroup: string;
  labels: string[];
}

export interface ChangedRunnerDiffEntry extends RunnerDiffEntry {
  actualRunnerGroup?: string;
  actualLabels: string[];
  missingLabels: string[];
  unexpectedLabels: string[];
}

export interface ConfigDiffReport {
  inSync: boolean;
  added: RunnerDiffEntry[];
  removed: Array<{
    id: number;
    organization: string;
    name: string;
    runnerGroup?: string;
    labels: string[];
    status: string;
  }>;
  changed: ChangedRunnerDiffEntry[];
}

export function desiredPoolsFromConfig(pools: PoolConfig[]): DesiredPoolState[] {
  return pools.map((pool) => ({
    name: pool.key,
    organization: pool.organization,
    runnerGroup: pool.runnerGroup,
    desired: pool.size
  }));
}

export function compareDesiredActualPools(
  desiredPools: DesiredPoolState[],
  actualPools: ActualPoolState[],
  threshold = 0
): DriftReport {
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new Error("drift threshold must be a non-negative integer");
  }

  const actualByName = new Map(
    actualPools.map((pool) => [pool.name, pool.actual])
  );
  const pools = desiredPools.map((pool) => {
    const actual = actualByName.get(pool.name) ?? 0;
    const drift = actual - pool.desired;
    return {
      name: pool.name,
      desired: pool.desired,
      actual,
      drift,
      status: statusForDrift(drift, threshold)
    };
  });

  return {
    pools,
    drifted: pools.some((pool) => pool.status !== "ok")
  };
}

export function compareDesiredActualRunners(
  desiredRunners: DesiredRunnerState[],
  actualRunners: ActualRunnerState[]
): ConfigDiffReport {
  const desiredByKey = new Map(
    desiredRunners.map((runner) => [runnerKey(runner.organization, runner.name), runner])
  );
  const actualByKey = new Map(
    actualRunners.map((runner) => [runnerKey(runner.organization, runner.name), runner])
  );
  const relevantGroups = new Set(
    desiredRunners.map((runner) => groupKey(runner.organization, runner.runnerGroup))
  );

  const added = desiredRunners
    .filter((runner) => !actualByKey.has(runnerKey(runner.organization, runner.name)))
    .map(toAddedEntry);

  const removed = actualRunners
    .filter((runner) => {
      const isExpectedName = desiredByKey.has(runnerKey(runner.organization, runner.name));
      const isRelevantGroup =
        runner.runnerGroup !== undefined &&
        relevantGroups.has(groupKey(runner.organization, runner.runnerGroup));
      return !isExpectedName && isRelevantGroup;
    })
    .map((runner) => ({
      id: runner.id,
      organization: runner.organization,
      name: runner.name,
      runnerGroup: runner.runnerGroup,
      labels: sortLabels(runner.labels),
      status: runner.status
    }));

  const changed = desiredRunners.flatMap((desired) => {
    const actual = actualByKey.get(runnerKey(desired.organization, desired.name));
    if (!actual) {
      return [];
    }

    const desiredLabels = sortLabels(desired.labels);
    const actualLabels = sortLabels(actual.labels);
    const missingLabels = desiredLabels.filter(
      (label) => !actualLabels.includes(label)
    );
    const unexpectedLabels = actualLabels.filter(
      (label) =>
        !desiredLabels.includes(label) && !isGitHubDefaultLabel(label)
    );
    const groupChanged = actual.runnerGroup !== desired.runnerGroup;

    if (!groupChanged && missingLabels.length === 0 && unexpectedLabels.length === 0) {
      return [];
    }

    return [
      {
        ...toAddedEntry(desired),
        actualRunnerGroup: actual.runnerGroup,
        actualLabels,
        missingLabels,
        unexpectedLabels
      }
    ];
  });

  return {
    inSync: added.length === 0 && removed.length === 0 && changed.length === 0,
    added,
    removed,
    changed
  };
}

export async function collectGitHubActualRunnerState(
  apiUrl: string,
  token: string,
  desiredRunners: DesiredRunnerState[],
  fetchImpl?: FetchLike
): Promise<ActualRunnerState[]> {
  const actualRunners: ActualRunnerState[] = [];
  const organizations = [
    ...new Set(desiredRunners.map((runner) => runner.organization))
  ];

  for (const organization of organizations) {
    const [groups, runners] = await Promise.all([
      fetchOrganizationRunnerGroups(apiUrl, organization, token, fetchImpl),
      fetchOrganizationRunners(apiUrl, organization, token, fetchImpl)
    ]);
    const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

    actualRunners.push(
      ...runners.map((runner) => ({
        id: runner.id,
        organization,
        name: runner.name,
        runnerGroup:
          runner.runnerGroupId === undefined
            ? undefined
            : groupNameById.get(runner.runnerGroupId),
        labels: runner.labels,
        status: runner.status
      }))
    );
  }

  return actualRunners;
}

export async function collectGitHubActualPoolState(
  apiUrl: string,
  token: string,
  desiredPools: DesiredPoolState[],
  fetchImpl?: FetchLike
): Promise<ActualPoolState[]> {
  const actualPools: ActualPoolState[] = [];
  const poolsByOrganization = groupByOrganization(desiredPools);

  for (const [organization, pools] of poolsByOrganization.entries()) {
    const [groups, runners] = await Promise.all([
      fetchOrganizationRunnerGroups(apiUrl, organization, token, fetchImpl),
      fetchOrganizationRunners(apiUrl, organization, token, fetchImpl)
    ]);

    for (const pool of pools) {
      const group = groups.find((entry) => entry.name === pool.runnerGroup);
      if (!group) {
        const available = groups.map((entry) => entry.name).sort().join(", ") || "none";
        throw new Error(
          `pool ${pool.name} expects runner group ${pool.runnerGroup} in organization ${organization}, but GitHub returned: ${available}`
        );
      }

      actualPools.push({
        name: pool.name,
        actual: runners.filter(
          (runner) =>
            runner.runnerGroupId === group.id && runner.status === "online"
        ).length
      });
    }
  }

  return actualPools;
}

function statusForDrift(drift: number, threshold: number): DriftStatus {
  if (drift < -threshold) {
    return "under-provisioned";
  }

  if (drift > threshold) {
    return "over-provisioned";
  }

  return "ok";
}

function groupByOrganization(
  pools: DesiredPoolState[]
): Map<string, DesiredPoolState[]> {
  const grouped = new Map<string, DesiredPoolState[]>();

  for (const pool of pools) {
    grouped.set(pool.organization, [
      ...(grouped.get(pool.organization) ?? []),
      pool
    ]);
  }

  return grouped;
}

function toAddedEntry(runner: DesiredRunnerState): RunnerDiffEntry {
  return {
    organization: runner.organization,
    name: runner.name,
    plane: runner.plane,
    poolKey: runner.poolKey,
    runnerGroup: runner.runnerGroup,
    labels: sortLabels(runner.labels)
  };
}

function runnerKey(organization: string, name: string): string {
  return `${organization}/${name}`;
}

function groupKey(organization: string, runnerGroup: string): string {
  return `${organization}/${runnerGroup}`;
}

function sortLabels(labels: string[]): string[] {
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right));
}

function isGitHubDefaultLabel(label: string): boolean {
  return new Set([
    "self-hosted",
    "linux",
    "windows",
    "macos",
    "x64",
    "arm",
    "arm64"
  ]).has(label.toLowerCase());
}
