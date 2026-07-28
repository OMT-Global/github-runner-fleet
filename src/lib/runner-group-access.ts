import type { RepositoryAccess } from "./config.js";
import {
  addRepositoryToRunnerGroup,
  fetchOrganizationRunnerGroupRepositories,
  fetchOrganizationRunnerGroups,
  type FetchLike,
  type GitHubRequestPolicy,
  type GitHubRunnerGroup
} from "./github.js";

export interface RunnerGroupAccessExpectation {
  poolKey: string;
  organization: string;
  runnerGroup: string;
  repositoryAccess: RepositoryAccess;
  allowedRepositories: string[];
  allowsPublicRepositories: boolean;
}

export interface RunnerGroupAccessStatus {
  poolKey: string;
  organization: string;
  runnerGroup: string;
  runnerGroupId: number;
  expectedVisibility: RepositoryAccess;
  actualVisibility?: string;
  expectedAllowsPublicRepositories: boolean;
  actualAllowsPublicRepositories?: boolean;
  expectedRepositories: string[];
  actualRepositories: string[];
  missingRepositories: string[];
  unexpectedRepositories: string[];
  policyMatches: boolean;
  ok: boolean;
}

export interface RunnerGroupAccessReconcileReport {
  apply: boolean;
  ok: boolean;
  addedRepositories: Array<{
    poolKey: string;
    repository: string;
  }>;
  blockedPolicyDrift: Array<{
    poolKey: string;
    expectedVisibility: RepositoryAccess;
    actualVisibility?: string;
    expectedAllowsPublicRepositories: boolean;
    actualAllowsPublicRepositories?: boolean;
  }>;
  pools: RunnerGroupAccessStatus[];
}

export async function inspectRunnerGroupAccess(
  apiUrl: string,
  token: string,
  expectations: RunnerGroupAccessExpectation[],
  fetchImpl: FetchLike = fetch as FetchLike,
  policy: GitHubRequestPolicy = {}
): Promise<RunnerGroupAccessStatus[]> {
  const groupsByOrganization = new Map<string, GitHubRunnerGroup[]>();

  for (const expectation of expectations) {
    const organizationKey = expectation.organization.toLowerCase();
    if (!groupsByOrganization.has(organizationKey)) {
      groupsByOrganization.set(
        organizationKey,
        await fetchOrganizationRunnerGroups(
          apiUrl,
          expectation.organization,
          token,
          fetchImpl,
          policy
        )
      );
    }
  }

  const statuses: RunnerGroupAccessStatus[] = [];
  for (const expectation of expectations) {
    const groups =
      groupsByOrganization.get(expectation.organization.toLowerCase()) ?? [];
    const group = groups.find(
      (candidate) =>
        candidate.name.toLowerCase() === expectation.runnerGroup.toLowerCase()
    );
    if (!group) {
      const available = groups.map((candidate) => candidate.name).sort().join(", ") || "none";
      throw new Error(
        `pool ${expectation.poolKey} expects runner group ${expectation.runnerGroup} in organization ${expectation.organization}, but GitHub returned: ${available}`
      );
    }

    const shouldReadRepositories =
      expectation.repositoryAccess === "selected" ||
      group.visibility === "selected";
    const actualRepositories = shouldReadRepositories
      ? (
          await fetchOrganizationRunnerGroupRepositories(
            apiUrl,
            expectation.organization,
            group.id,
            token,
            fetchImpl,
            policy
          )
        ).map((repository) => repository.fullName)
      : [];
    const expectedRepositories =
      expectation.repositoryAccess === "selected"
        ? sortedUnique(expectation.allowedRepositories)
        : [];
    const actualByKey = new Map(
      actualRepositories.map((repository) => [repositoryKey(repository), repository])
    );
    const expectedByKey = new Map(
      expectedRepositories.map((repository) => [repositoryKey(repository), repository])
    );
    const missingRepositories = expectedRepositories.filter(
      (repository) => !actualByKey.has(repositoryKey(repository))
    );
    const unexpectedRepositories = sortedUnique(
      actualRepositories.filter(
        (repository) => !expectedByKey.has(repositoryKey(repository))
      )
    );
    const policyMatches =
      group.visibility === expectation.repositoryAccess &&
      group.allowsPublicRepositories === expectation.allowsPublicRepositories;

    statuses.push({
      poolKey: expectation.poolKey,
      organization: expectation.organization,
      runnerGroup: group.name,
      runnerGroupId: group.id,
      expectedVisibility: expectation.repositoryAccess,
      actualVisibility: group.visibility,
      expectedAllowsPublicRepositories: expectation.allowsPublicRepositories,
      actualAllowsPublicRepositories: group.allowsPublicRepositories,
      expectedRepositories,
      actualRepositories: sortedUnique(actualRepositories),
      missingRepositories,
      unexpectedRepositories,
      policyMatches,
      ok:
        policyMatches &&
        missingRepositories.length === 0 &&
        unexpectedRepositories.length === 0
    });
  }

  return statuses;
}

export async function reconcileRunnerGroupAccess(
  apiUrl: string,
  token: string,
  expectations: RunnerGroupAccessExpectation[],
  apply: boolean,
  fetchImpl: FetchLike = fetch as FetchLike,
  policy: GitHubRequestPolicy = {}
): Promise<RunnerGroupAccessReconcileReport> {
  const initial = await inspectRunnerGroupAccess(
    apiUrl,
    token,
    expectations,
    fetchImpl,
    policy
  );
  const addedRepositories: RunnerGroupAccessReconcileReport["addedRepositories"] = [];
  const blockedPolicyDrift: RunnerGroupAccessReconcileReport["blockedPolicyDrift"] = [];

  for (const status of initial) {
    if (!status.policyMatches) {
      blockedPolicyDrift.push({
        poolKey: status.poolKey,
        expectedVisibility: status.expectedVisibility,
        actualVisibility: status.actualVisibility,
        expectedAllowsPublicRepositories:
          status.expectedAllowsPublicRepositories,
        actualAllowsPublicRepositories: status.actualAllowsPublicRepositories
      });
      continue;
    }
    if (!apply) {
      continue;
    }
    for (const repository of status.missingRepositories) {
      await addRepositoryToRunnerGroup(
        apiUrl,
        status.organization,
        status.runnerGroupId,
        repository,
        token,
        fetchImpl,
        policy
      );
      addedRepositories.push({
        poolKey: status.poolKey,
        repository
      });
    }
  }

  const pools =
    apply && addedRepositories.length > 0
      ? await inspectRunnerGroupAccess(
          apiUrl,
          token,
          expectations,
          fetchImpl,
          policy
        )
      : initial;

  return {
    apply,
    ok: pools.every((pool) => pool.ok),
    addedRepositories,
    blockedPolicyDrift,
    pools
  };
}

function repositoryKey(repository: string): string {
  return repository.toLowerCase();
}

function sortedUnique(repositories: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const repository of repositories) {
    const key = repositoryKey(repository);
    if (!byKey.has(key)) {
      byKey.set(key, repository);
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" })
  );
}
