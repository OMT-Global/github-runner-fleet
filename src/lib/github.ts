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

export interface GitHubContainerImageVersion {
  imageRef: string;
  owner: string;
  packageName: string;
  tag: string;
  versionId: number;
  updatedAt?: string;
  ownerType: "orgs" | "users";
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
    "User-Agent": "github-runner-fleet",
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

export async function verifyContainerImageTag(
  apiUrl: string,
  token: string,
  imageRef: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<GitHubContainerImageVersion> {
  const parsed = parseGhcrImageRef(imageRef);
  const attemptedScopes: Array<"orgs" | "users"> = ["orgs", "users"];
  const seenTags = new Set<string>();

  for (const ownerType of attemptedScopes) {
    let sawPackage = false;

    for (let page = 1; page <= 10; page += 1) {
      const response = await fetchImpl(
        `${trimApiUrl(apiUrl)}/${ownerType}/${parsed.owner}/packages/container/${encodeURIComponent(
          parsed.packageName
        )}/versions?per_page=100&page=${page}`,
        {
          method: "GET",
          headers: buildGitHubApiHeaders(token)
        }
      );

      const body = await response.text();
      if (response.status === 404) {
        break;
      }

      if (!response.ok) {
        throw new Error(
          `GitHub container package lookup failed for ${imageRef} with ${response.status}: ${body}`
        );
      }

      sawPackage = true;
      const versions = parseContainerPackageVersions(body, imageRef);
      if (versions.length === 0) {
        break;
      }

      for (const version of versions) {
        for (const versionTag of version.tags) {
          seenTags.add(versionTag);
        }

        if (version.tags.includes(parsed.tag)) {
          return {
            imageRef,
            owner: parsed.owner,
            packageName: parsed.packageName,
            tag: parsed.tag,
            versionId: version.id,
            updatedAt: version.updatedAt,
            ownerType
          };
        }
      }
    }

    if (sawPackage) {
      const availableTags = [...seenTags].sort().join(", ") || "none";
      throw new Error(
        `GitHub container package ${parsed.owner}/${parsed.packageName} does not include tag ${parsed.tag}; available tags: ${availableTags}`
      );
    }
  }

  throw new Error(
    `GitHub container package ${parsed.owner}/${parsed.packageName} was not found for ${imageRef}`
  );
}

function trimApiUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseGhcrImageRef(
  imageRef: string
): { owner: string; packageName: string; tag: string } {
  const match = imageRef.match(/^ghcr\.io\/([^/]+)\/(.+):([^:@/]+)$/);

  if (!match) {
    throw new Error(
      `image reference ${imageRef} must match ghcr.io/<owner>/<package>:<tag>`
    );
  }

  const [, owner, packageName, tag] = match;
  return { owner, packageName, tag };
}

function parseContainerPackageVersions(
  body: string,
  imageRef: string
): Array<{ id: number; updatedAt?: string; tags: string[] }> {
  const payload = JSON.parse(body) as Array<{
    id?: number;
    updated_at?: string;
    metadata?: {
      container?: {
        tags?: string[];
      };
    };
  }>;

  if (!Array.isArray(payload)) {
    throw new Error(
      `GitHub container package response for ${imageRef} did not return an array`
    );
  }

  return payload.map((version) => {
    if (typeof version.id !== "number") {
      throw new Error(
        `GitHub container package response for ${imageRef} included an invalid version entry`
      );
    }

    return {
      id: version.id,
      updatedAt: version.updated_at,
      tags: Array.isArray(version.metadata?.container?.tags)
        ? version.metadata.container.tags.filter(
            (tag): tag is string => typeof tag === "string"
          )
        : []
    };
  });
}
