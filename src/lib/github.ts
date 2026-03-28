import { normalizeRunnerVersion } from "./runner-version.js";

export interface RunnerTokenRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
}

export interface GitHubRelease {
  version: string;
  tagName: string;
  publishedAt?: string;
  htmlUrl?: string;
}

export interface GitHubRunnerGroup {
  id: number;
  name: string;
  visibility?: string;
  isDefault?: boolean;
}

export interface RunnerGroupExpectation {
  poolKey: string;
  organization: string;
  runnerGroup: string;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  }
) => Promise<FetchLikeResponse>;

export function buildGitHubApiHeaders(
  token?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "synology-github-runner",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export function buildRegistrationTokenRequest(
  apiUrl: string,
  organization: string,
  token: string
): RunnerTokenRequest {
  return {
    method: "POST",
    url: `${trimApiUrl(apiUrl)}/orgs/${organization}/actions/runners/registration-token`,
    headers: buildGitHubApiHeaders(token)
  };
}

export function buildRemoveTokenRequest(
  apiUrl: string,
  organization: string,
  token: string
): RunnerTokenRequest {
  return {
    method: "POST",
    url: `${trimApiUrl(apiUrl)}/orgs/${organization}/actions/runners/remove-token`,
    headers: buildGitHubApiHeaders(token)
  };
}

export async function fetchRunnerToken(
  request: RunnerTokenRequest,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<string> {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub token request failed with ${response.status}: ${body}`
    );
  }

  const payload = JSON.parse(body) as { token?: string };
  if (!payload.token) {
    throw new Error("GitHub token response did not include a token");
  }

  return payload.token;
}

export async function fetchLatestRunnerRelease(
  apiUrl = "https://api.github.com",
  token?: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<GitHubRelease> {
  const response = await fetchImpl(
    `${trimApiUrl(apiUrl)}/repos/actions/runner/releases/latest`,
    {
      method: "GET",
      headers: buildGitHubApiHeaders(token)
    }
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub runner release lookup failed with ${response.status}: ${body}`
    );
  }

  const payload = JSON.parse(body) as {
    tag_name?: string;
    published_at?: string;
    html_url?: string;
  };

  if (!payload.tag_name) {
    throw new Error("GitHub release response did not include tag_name");
  }

  return {
    version: normalizeRunnerVersion(payload.tag_name),
    tagName: payload.tag_name,
    publishedAt: payload.published_at,
    htmlUrl: payload.html_url
  };
}

export async function fetchOrganizationRunnerGroups(
  apiUrl: string,
  organization: string,
  token: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<GitHubRunnerGroup[]> {
  const response = await fetchImpl(
    `${trimApiUrl(apiUrl)}/orgs/${organization}/actions/runner-groups?per_page=100`,
    {
      method: "GET",
      headers: buildGitHubApiHeaders(token)
    }
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub runner group lookup failed for ${organization} with ${response.status}: ${body}`
    );
  }

  const payload = JSON.parse(body) as {
    runner_groups?: Array<{
      id?: number;
      name?: string;
      visibility?: string;
      default?: boolean;
    }>;
  };

  if (!Array.isArray(payload.runner_groups)) {
    throw new Error(
      `GitHub runner group response for ${organization} did not include runner_groups`
    );
  }

  return payload.runner_groups.map((group) => {
    if (typeof group.id !== "number" || !group.name) {
      throw new Error(
        `GitHub runner group response for ${organization} included an invalid group entry`
      );
    }

    return {
      id: group.id,
      name: group.name,
      visibility: group.visibility,
      isDefault: group.default
    };
  });
}

export async function verifyRunnerGroups(
  apiUrl: string,
  token: string,
  expectations: RunnerGroupExpectation[],
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<
  Array<{
    poolKey: string;
    organization: string;
    runnerGroup: string;
    visibility?: string;
    isDefault?: boolean;
  }>
> {
  const groupsByOrganization = new Map<string, GitHubRunnerGroup[]>();

  for (const expectation of expectations) {
    if (!groupsByOrganization.has(expectation.organization)) {
      groupsByOrganization.set(
        expectation.organization,
        await fetchOrganizationRunnerGroups(
          apiUrl,
          expectation.organization,
          token,
          fetchImpl
        )
      );
    }
  }

  return expectations.map((expectation) => {
    const groups = groupsByOrganization.get(expectation.organization) ?? [];
    const match = groups.find((group) => group.name === expectation.runnerGroup);

    if (!match) {
      const available = groups.map((group) => group.name).sort().join(", ") || "none";
      throw new Error(
        `pool ${expectation.poolKey} expects runner group ${expectation.runnerGroup} in organization ${expectation.organization}, but GitHub returned: ${available}`
      );
    }

    return {
      poolKey: expectation.poolKey,
      organization: expectation.organization,
      runnerGroup: match.name,
      visibility: match.visibility,
      isDefault: match.isDefault
    };
  });
}

function trimApiUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
