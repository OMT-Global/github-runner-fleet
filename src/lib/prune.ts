import {
  deleteOrganizationRunner,
  fetchOrganizationRunnerGroups,
  fetchOrganizationRunners,
  type FetchLike,
  type GitHubRunner
} from "./github.js";

export interface PrunePoolDefinition {
  plane: string;
  key: string;
  organization: string;
  runnerGroup: string;
  runnerNames: string[];
}

export interface StaleRunnerCandidate {
  plane: string;
  poolKey: string;
  organization: string;
  runnerGroup: string;
  id: number;
  name: string;
  status: string;
  busy: boolean;
  deleted?: boolean;
}

export interface PruneStaleRunnersReport {
  apply: boolean;
  groups: Array<{
    plane: string;
    poolKey: string;
    organization: string;
    runnerGroup: string;
    expected: string[];
    scanned: number;
  }>;
  stale: StaleRunnerCandidate[];
  deleted: string[];
}

export interface PruneStaleRunnersOptions {
  apiUrl: string;
  token: string;
  pools: PrunePoolDefinition[];
  apply: boolean;
  fetchImpl?: FetchLike;
}

export async function pruneStaleRunners(
  options: PruneStaleRunnersOptions
): Promise<PruneStaleRunnersReport> {
  const groups = mergeDefinitions(options.pools);
  const stale: StaleRunnerCandidate[] = [];
  const deleted: string[] = [];
  const groupsByOrganization = groupByOrganization(groups);

  for (const [organization, definitions] of groupsByOrganization.entries()) {
    const [runnerGroups, runners] = await Promise.all([
      fetchOrganizationRunnerGroups(
        options.apiUrl,
        organization,
        options.token,
        options.fetchImpl
      ),
      fetchOrganizationRunners(
        options.apiUrl,
        organization,
        options.token,
        options.fetchImpl
      )
    ]);

    for (const definition of definitions) {
      const runnerGroup = runnerGroups.find(
        (group) => group.name === definition.runnerGroup
      );
      if (!runnerGroup) {
        const available =
          runnerGroups.map((group) => group.name).sort().join(", ") || "none";
        throw new Error(
          `pool ${definition.key} expects runner group ${definition.runnerGroup} in organization ${organization}, but GitHub returned: ${available}`
        );
      }

      const expectedNames = new Set(definition.runnerNames);
      const scopedRunners = runners.filter(
        (runner) => runner.runnerGroupId === runnerGroup.id
      );
      const candidates: StaleRunnerCandidate[] = scopedRunners
        .filter((runner) => isSafeStaleRunner(runner, expectedNames))
        .map((runner) => ({
          plane: definition.plane,
          poolKey: definition.key,
          organization,
          runnerGroup: definition.runnerGroup,
          id: runner.id,
          name: runner.name,
          status: runner.status,
          busy: runner.busy ?? false
        }));

      for (const candidate of candidates) {
        if (options.apply) {
          candidate.deleted = await deleteOrganizationRunner(
            options.apiUrl,
            organization,
            options.token,
            candidate.id,
            options.fetchImpl
          );
          if (candidate.deleted) {
            deleted.push(candidate.name);
          }
        }
        stale.push(candidate);
      }

      definition.scanned = scopedRunners.length;
    }
  }

  return {
    apply: options.apply,
    groups: groups.map((group) => ({
      plane: group.plane,
      poolKey: group.key,
      organization: group.organization,
      runnerGroup: group.runnerGroup,
      expected: [...group.runnerNames].sort(),
      scanned: group.scanned ?? 0
    })),
    stale,
    deleted: deleted.sort()
  };
}

function isSafeStaleRunner(
  runner: GitHubRunner,
  expectedNames: Set<string>
): boolean {
  return (
    runner.status === "offline" &&
    runner.busy !== true &&
    !expectedNames.has(runner.name)
  );
}

type MergedPrunePoolDefinition = PrunePoolDefinition & { scanned?: number };

function mergeDefinitions(
  pools: PrunePoolDefinition[]
): MergedPrunePoolDefinition[] {
  const merged = new Map<string, MergedPrunePoolDefinition>();

  for (const pool of pools) {
    const key = [pool.organization, pool.runnerGroup].join("\0");
    const existing = merged.get(key);
    if (existing) {
      existing.plane = uniqueSorted([...existing.plane.split(","), pool.plane]).join(",");
      existing.key = uniqueSorted([...existing.key.split(","), pool.key]).join(",");
      existing.runnerNames = uniqueSorted([
        ...existing.runnerNames,
        ...pool.runnerNames
      ]);
      continue;
    }

    merged.set(key, {
      ...pool,
      runnerNames: uniqueSorted(pool.runnerNames)
    });
  }

  return [...merged.values()];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function groupByOrganization(
  pools: MergedPrunePoolDefinition[]
): Map<string, MergedPrunePoolDefinition[]> {
  const grouped = new Map<string, MergedPrunePoolDefinition[]>();

  for (const pool of pools) {
    grouped.set(pool.organization, [
      ...(grouped.get(pool.organization) ?? []),
      pool
    ]);
  }

  return grouped;
}
