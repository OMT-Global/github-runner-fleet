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
