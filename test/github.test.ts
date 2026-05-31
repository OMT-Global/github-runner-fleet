import { afterEach, describe, expect, test, vi } from "vitest";
import crypto from "node:crypto";
import {
  buildGitHubApiHeaders,
  buildGitHubAppJwt,
  buildRegistrationTokenRequest,
  deleteOrganizationRunner,
  fetchGitHubAppInstallationToken,
  buildRemoveTokenRequest,
  fetchOrganizationRepositories,
  fetchOrganizationRunnerGroupRunners,
  fetchOrganizationRunnerGroups,
  fetchOrganizationRunners,
  fetchQueuedWorkflowRuns,
  fetchLatestRunnerRelease,
  fetchWorkflowRunJobs,
  fetchRunnerToken,
  getQueuedJobCount,
  hasGitHubAuth,
  resolveGitHubAccessToken,
  verifyContainerImageTag,
  verifyRunnerGroups
} from "../src/lib/github.js";

describe("github runner API helpers", () => {
  test("builds organization token endpoints", () => {
    const registration = buildRegistrationTokenRequest(
      "https://api.github.com",
      "example",
      "secret"
    );
    const removal = buildRemoveTokenRequest(
      "https://api.github.com",
      "example",
      "secret"
    );

    expect(registration.url).toBe(
      "https://api.github.com/orgs/example/actions/runners/registration-token"
    );
    expect(removal.url).toBe(
      "https://api.github.com/orgs/example/actions/runners/remove-token"
    );
    expect(registration.headers.Authorization).toBe("Bearer secret");
  });

  test("parses runner token responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ token: "registration-token" })
    });

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest(
          "https://api.github.com",
          "example",
          "secret"
        ),
        fetchMock
      )
    ).resolves.toBe("registration-token");
  });

  test("parses latest runner release metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          tag_name: "v2.327.1",
          published_at: "2026-03-25T00:00:00Z",
          html_url: "https://github.com/actions/runner/releases/tag/v2.327.1"
        })
    });

    await expect(fetchLatestRunnerRelease(undefined, undefined, fetchMock)).resolves
      .toMatchObject({
        version: "2.327.1",
        publishedAt: "2026-03-25T00:00:00Z"
      });
  });

  test("parses organization runner groups", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          total_count: 2,
          runner_groups: [
            {
              id: 1,
              name: "Default",
              visibility: "all",
              default: true
            },
            {
              id: 2,
              name: "synology-private",
              visibility: "all",
              default: false
            }
          ]
        })
    });

    await expect(
      fetchOrganizationRunnerGroups(
        "https://api.github.com",
        "example",
        "secret",
        fetchMock
      )
    ).resolves.toEqual([
      {
        id: 1,
        name: "Default",
        visibility: "all",
        isDefault: true
      },
      {
        id: 2,
        name: "synology-private",
        visibility: "all",
        isDefault: false
      }
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/orgs/example/actions/runner-groups?per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("paginates organization runner groups beyond the first page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runner_groups: Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              name: `group-${index + 1}`,
              visibility: "all",
              default: false
            }))
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runner_groups: [
              {
                id: 101,
                name: "group-101",
                visibility: "selected",
                default: false
              }
            ]
          })
      });

    await expect(
      fetchOrganizationRunnerGroups(
        "https://api.github.com",
        "example",
        "secret",
        fetchMock
      )
    ).resolves.toHaveLength(101);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/orgs/example/actions/runner-groups?per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/orgs/example/actions/runner-groups?per_page=100&page=2",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("parses organization self-hosted runners", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          runners: [
            {
              id: 101,
              name: "synology-private-runner-01",
              status: "online",
              busy: false,
              runner_group_id: 2,
              labels: [{ name: "self-hosted" }, { name: "synology" }]
            }
          ]
        })
    });

    await expect(
      fetchOrganizationRunners(
        "https://api.github.com",
        "example",
        "secret",
        fetchMock
      )
    ).resolves.toEqual([
      {
        id: 101,
        name: "synology-private-runner-01",
        status: "online",
        busy: false,
        runnerGroupId: 2,
        labels: ["self-hosted", "synology"]
      }
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/orgs/example/actions/runners?per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("deletes organization self-hosted runners idempotently", async () => {
    const deletedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => ""
    });
    const missingFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found"
    });

    await expect(
      deleteOrganizationRunner(
        "https://api.github.com",
        "example",
        "secret",
        101,
        deletedFetch
      )
    ).resolves.toBe(true);
    await expect(
      deleteOrganizationRunner(
        "https://api.github.com",
        "example",
        "secret",
        101,
        missingFetch
      )
    ).resolves.toBe(false);

    expect(deletedFetch).toHaveBeenCalledWith(
      "https://api.github.com/orgs/example/actions/runners/101",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("parses organization repositories", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            full_name: "example/private-app"
          }
        ])
    });

    await expect(
      fetchOrganizationRepositories(
        "https://api.github.com",
        "example",
        "secret",
        fetchMock
      )
    ).resolves.toEqual([{ fullName: "example/private-app" }]);
  });

  test("counts queued workflow jobs for a runner group", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            workflow_runs: [
              {
                id: 42,
                jobs_url: "https://api.github.com/repos/example/private-app/actions/runs/42/jobs"
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ workflow_runs: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            jobs: [
              {
                id: 1,
                status: "queued",
                runner_group_name: "synology-private",
                labels: ["synology", "shell-only"]
              },
              {
                id: 2,
                status: "queued",
                runner_group_name: "linux-private",
                labels: ["linux"]
              },
              {
                id: 3,
                status: "in_progress",
                runner_group_name: "synology-private",
                labels: ["synology", "shell-only"]
              }
            ]
          })
      });

    await expect(
      getQueuedJobCount(
        "https://api.github.com",
        "secret",
        {
          organization: "example",
          runnerGroup: "synology-private",
          repositories: ["example/private-app"],
          labels: ["synology", "shell-only"]
        },
        fetchMock
      )
    ).resolves.toBe(1);
  });

  test("counts queued jobs in active workflow runs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ workflow_runs: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            workflow_runs: [
              {
                id: 43,
                jobs_url: "https://api.github.com/repos/example/private-app/actions/runs/43/jobs"
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            jobs: [
              {
                id: 4,
                status: "queued",
                runner_group_name: "synology-private",
                labels: ["synology", "shell-only"]
              }
            ]
          })
      });

    await expect(
      getQueuedJobCount(
        "https://api.github.com",
        "secret",
        {
          organization: "example",
          runnerGroup: "synology-private",
          repositories: ["example/private-app"],
          labels: ["synology", "shell-only"]
        },
        fetchMock
      )
    ).resolves.toBe(1);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/example/private-app/actions/runs?status=in_progress&per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("uses labels when queued jobs do not include runner group metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            workflow_runs: [
              {
                id: 42,
                jobs_url: "https://api.github.com/repos/example/private-app/actions/runs/42/jobs"
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ workflow_runs: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            jobs: [
              {
                id: 1,
                status: "queued",
                labels: ["synology", "shell-only", "private"]
              }
            ]
          })
      });

    await expect(
      getQueuedJobCount(
        "https://api.github.com",
        "secret",
        {
          organization: "example",
          runnerGroup: "synology-private",
          repositories: ["example/private-app"],
          labels: ["synology", "shell-only", "private"]
        },
        fetchMock
      )
    ).resolves.toBe(1);
  });

  test("parses queued workflow runs and workflow jobs directly", async () => {
    const runsFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          workflow_runs: [
            {
              id: 42,
              jobs_url: "https://api.github.com/repos/example/private-app/actions/runs/42/jobs"
            }
          ]
        })
    });
    const jobsFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          jobs: [
            {
              id: 1,
              status: "queued",
              runner_group_name: "synology-private",
              labels: ["synology"]
            }
          ]
        })
    });

    await expect(
      fetchQueuedWorkflowRuns(
        "https://api.github.com",
        "example/private-app",
        "secret",
        runsFetch
      )
    ).resolves.toEqual([
      {
        id: 42,
        jobsUrl: "https://api.github.com/repos/example/private-app/actions/runs/42/jobs"
      }
    ]);
    await expect(
      fetchWorkflowRunJobs(
        "https://api.github.com/repos/example/private-app/actions/runs/42/jobs",
        "secret",
        jobsFetch
      )
    ).resolves.toEqual([
      {
        id: 1,
        status: "queued",
        labels: ["synology"],
        runnerGroupName: "synology-private"
      }
    ]);
  });

  test("verifies expected runner groups", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          runner_groups: [
            {
              id: 2,
              name: "synology-private",
              visibility: "all",
              default: false
            },
            {
              id: 3,
              name: "synology-public",
              visibility: "selected",
              default: false
            }
          ]
        })
    });

    await expect(
      verifyRunnerGroups("https://api.github.com", "secret", [
        {
          poolKey: "synology-private",
          organization: "example",
          runnerGroup: "synology-private"
        },
        {
          poolKey: "synology-public",
          organization: "example",
          runnerGroup: "synology-public"
        }
      ], fetchMock)
    ).resolves.toEqual([
      {
        poolKey: "synology-private",
        organization: "example",
        runnerGroup: "synology-private",
        visibility: "all",
        isDefault: false
      },
      {
        poolKey: "synology-public",
        organization: "example",
        runnerGroup: "synology-public",
        visibility: "selected",
        isDefault: false
      }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fails when an expected runner group is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          runner_groups: [
            {
              id: 1,
              name: "Default",
              visibility: "all",
              default: true
            }
          ]
        })
    });

    await expect(
      verifyRunnerGroups("https://api.github.com", "secret", [
        {
          poolKey: "synology-private",
          organization: "example",
          runnerGroup: "synology-private"
        }
      ], fetchMock)
    ).rejects.toThrow(
      /pool synology-private expects runner group synology-private in organization example/
    );
  });

  test("throws on non-ok token response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Bad credentials"
    });

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest("https://api.github.com", "example", "bad"),
        fetchMock
      )
    ).rejects.toThrow(/failed with 401/);
  });

  test("throws when token field is missing from response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({})
    });

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest("https://api.github.com", "example", "secret"),
        fetchMock
      )
    ).rejects.toThrow(/did not include a token/);
  });

  test("throws on non-ok release response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Not Found"
    });

    await expect(
      fetchLatestRunnerRelease("https://api.github.com", "secret", fetchMock)
    ).rejects.toThrow(/failed with 404/);
  });

  test("verifies a published GHCR tag through the organization package API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            id: 101,
            updated_at: "2026-03-28T16:29:47Z",
            metadata: {
              container: {
                tags: ["0.1.5", "latest"]
              }
            }
          }
        ])
    });

    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/omt-global/github-runner-fleet:0.1.5",
        fetchMock
      )
    ).resolves.toEqual({
      imageRef: "ghcr.io/omt-global/github-runner-fleet:0.1.5",
      owner: "omt-global",
      packageName: "github-runner-fleet",
      tag: "0.1.5",
      versionId: 101,
      updatedAt: "2026-03-28T16:29:47Z",
      ownerType: "orgs"
    });
  });

  test("falls back to user package lookup when org scope is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found"
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            {
              id: 77,
              metadata: {
                container: {
                  tags: ["0.1.5"]
                }
              }
            }
          ])
      });

    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/jmcte/github-runner-fleet:0.1.5",
        fetchMock
      )
    ).resolves.toMatchObject({
      owner: "jmcte",
      ownerType: "users",
      versionId: 77
    });
  });

  test("fails when the package exists but the configured tag is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify([
          {
            id: 101,
            metadata: {
              container: {
                tags: ["0.1.4", "latest"]
              }
            }
          }
        ])
    });

    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/omt-global/github-runner-fleet:0.1.5",
        fetchMock
      )
    ).rejects.toThrow(/does not include tag 0\.1\.5; available tags: 0\.1\.4, latest/);
  });
});

describe("github app auth", () => {
  test("builds a signed JWT and exchanges it for an installation token", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          token: "installation-token",
          expires_at: "2030-01-01T00:00:00Z"
        })
    });

    const jwt = buildGitHubAppJwt({
      appId: "123",
      privateKey: pem,
      nowSeconds: 1_700_000_000
    });
    expect(jwt.split(".")).toHaveLength(3);

    await expect(
      fetchGitHubAppInstallationToken(
        "https://api.github.com",
        "123",
        "456",
        Buffer.from(pem).toString("base64"),
        fetchMock,
        new Date("2026-01-01T00:00:00Z")
      )
    ).resolves.toMatchObject({
      token: "installation-token",
      expiresAt: new Date("2030-01-01T00:00:00Z")
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/456/access_tokens",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("prefers app auth over PAT when resolving GitHub access", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          token: "installation-token",
          expires_at: "2030-01-01T00:00:00Z"
        })
    });

    expect(
      hasGitHubAuth({
        githubAppId: "123",
        githubAppInstallationId: "456",
        githubAppPrivateKey: pem
      })
    ).toBe(true);
    await expect(
      resolveGitHubAccessToken(
        {
          githubPat: "pat-token",
          githubAppId: "123",
          githubAppInstallationId: "456",
          githubAppPrivateKey: pem
        },
        fetchMock
      )
    ).resolves.toBe("installation-token");
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

function rawResponse(body: string, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

describe("github API header and URL construction", () => {
  test("includes the fixed GitHub API headers and omits auth without a token", () => {
    expect(buildGitHubApiHeaders()).toEqual({
      Accept: "application/vnd.github+json",
      "User-Agent": "github-runner-fleet",
      "X-GitHub-Api-Version": "2022-11-28"
    });
  });

  test("adds a bearer Authorization header when a token is supplied", () => {
    expect(buildGitHubApiHeaders("abc123")).toEqual({
      Accept: "application/vnd.github+json",
      "User-Agent": "github-runner-fleet",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer abc123"
    });
  });

  test("treats an empty token as unauthenticated", () => {
    expect(buildGitHubApiHeaders("")).not.toHaveProperty("Authorization");
  });

  test("strips every trailing slash from the API URL", () => {
    expect(
      buildRegistrationTokenRequest(
        "https://ghe.example.com/api/v3///",
        "example",
        "secret"
      ).url
    ).toBe(
      "https://ghe.example.com/api/v3/orgs/example/actions/runners/registration-token"
    );
    expect(
      buildRemoveTokenRequest("https://api.github.com", "acme", "tok").url
    ).toBe("https://api.github.com/orgs/acme/actions/runners/remove-token");
  });
});

describe("github runner token failures and observability", () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.METRICS_ENDPOINT;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEndpoint === undefined) {
      delete process.env.METRICS_ENDPOINT;
    } else {
      process.env.METRICS_ENDPOINT = originalEndpoint;
    }
    vi.restoreAllMocks();
  });

  test("surfaces the status and body on a non-ok token response", async () => {
    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest("https://api.github.com", "example", "x"),
        vi.fn().mockResolvedValue(rawResponse("forbidden detail", 403))
      )
    ).rejects.toThrow("GitHub token request failed with 403: forbidden detail");
  });

  test("emits a token fetch duration metric tagged with the supplied plane", async () => {
    process.env.METRICS_ENDPOINT = "https://metrics.example.com/push";
    const metricsFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = metricsFetch as unknown as typeof fetch;

    await fetchRunnerToken(
      buildRegistrationTokenRequest("https://api.github.com", "example", "x"),
      vi.fn().mockResolvedValue(jsonResponse({ token: "t" }, 201)),
      { plane: "synology" }
    );

    expect(metricsFetch).toHaveBeenCalledTimes(1);
    const body = metricsFetch.mock.calls[0][1].body as string;
    expect(body).toContain("runner_token_fetch_duration_seconds");
    expect(body).toContain('plane="synology"');
  });

  test("defaults the metric plane to unknown when none is provided", async () => {
    process.env.METRICS_ENDPOINT = "https://metrics.example.com/push";
    const metricsFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = metricsFetch as unknown as typeof fetch;

    await fetchRunnerToken(
      buildRegistrationTokenRequest("https://api.github.com", "example", "x"),
      vi.fn().mockResolvedValue(jsonResponse({ token: "t" }, 201))
    );

    expect(metricsFetch.mock.calls[0][1].body as string).toContain(
      'plane="unknown"'
    );
  });

  test("still emits the duration metric when the token request throws", async () => {
    process.env.METRICS_ENDPOINT = "https://metrics.example.com/push";
    const metricsFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = metricsFetch as unknown as typeof fetch;

    await expect(
      fetchRunnerToken(
        buildRegistrationTokenRequest("https://api.github.com", "example", "x"),
        vi.fn().mockRejectedValue(new Error("network down")),
        { plane: "lume" }
      )
    ).rejects.toThrow("network down");

    expect(metricsFetch).toHaveBeenCalledTimes(1);
    expect(metricsFetch.mock.calls[0][1].body as string).toContain(
      'plane="lume"'
    );
  });
});

describe("github release validation", () => {
  test("reports the status and body when the release lookup is not ok", async () => {
    await expect(
      fetchLatestRunnerRelease(
        "https://api.github.com",
        "secret",
        vi.fn().mockResolvedValue(rawResponse("rate limited", 429))
      )
    ).rejects.toThrow(
      "GitHub runner release lookup failed with 429: rate limited"
    );
  });

  test("rejects a release payload without a tag_name", async () => {
    await expect(
      fetchLatestRunnerRelease(
        "https://api.github.com",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse({ html_url: "x" }))
      )
    ).rejects.toThrow("GitHub release response did not include tag_name");
  });

  test("requests the latest release endpoint with GET and auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ tag_name: "v2.1.0" }));

    await fetchLatestRunnerRelease("https://api.github.com", "tok", fetchMock);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/actions/runner/releases/latest",
      {
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer tok" })
      }
    );
  });
});

describe("github pagination boundaries", () => {
  test("stops paginating runners exactly at a short final page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          runners: Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            name: `r-${index + 1}`,
            status: "online",
            labels: []
          }))
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          runners: [{ id: 101, name: "r-101", status: "offline", labels: [] }]
        })
      );

    const runners = await fetchOrganizationRunners(
      "https://api.github.com",
      "example",
      "secret",
      fetchMock
    );

    expect(runners).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/orgs/example/actions/runners?per_page=100&page=2",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("does not request a second page when the first page is not full", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        runners: [{ id: 1, name: "only", status: "online", labels: [] }]
      })
    );

    await fetchOrganizationRunners(
      "https://api.github.com",
      "example",
      "secret",
      fetchMock
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("paginates repositories and workflow runs across pages", async () => {
    const repoFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          Array.from({ length: 100 }, (_, index) => ({
            full_name: `example/repo-${index}`
          }))
        )
      )
      .mockResolvedValueOnce(jsonResponse([{ full_name: "example/last" }]));

    await expect(
      fetchOrganizationRepositories(
        "https://api.github.com",
        "example",
        "secret",
        repoFetch
      )
    ).resolves.toHaveLength(101);
    expect(repoFetch).toHaveBeenCalledTimes(2);

    const runsFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          workflow_runs: Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            jobs_url: `https://api.github.com/runs/${index + 1}/jobs`
          }))
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ workflow_runs: [{ id: 999, jobs_url: "u" }] })
      );

    await expect(
      fetchQueuedWorkflowRuns(
        "https://api.github.com",
        "example/app",
        "secret",
        runsFetch
      )
    ).resolves.toHaveLength(101);
    expect(runsFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/example/app/actions/runs?status=queued&per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("uses the runner group id as a fallback when entries omit it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        runners: [
          {
            id: 7,
            name: "grouped",
            status: "online",
            labels: [{ name: "self-hosted" }, { name: 42 }]
          }
        ]
      })
    );

    const runners = await fetchOrganizationRunnerGroupRunners(
      "https://api.github.com",
      "example",
      99,
      "secret",
      fetchMock
    );

    expect(runners[0].runnerGroupId).toBe(99);
    expect(runners[0].labels).toEqual(["self-hosted"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/orgs/example/actions/runner-groups/99/runners?per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("github malformed payload handling", () => {
  test("rejects runner-group payloads that are not arrays", async () => {
    await expect(
      fetchOrganizationRunnerGroups(
        "https://api.github.com",
        "acme",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse({ runner_groups: "nope" }))
      )
    ).rejects.toThrow(
      "GitHub runner group response for acme did not include runner_groups"
    );
  });

  test("rejects runner-group entries that lack an id or name", async () => {
    await expect(
      fetchOrganizationRunnerGroups(
        "https://api.github.com",
        "acme",
        "secret",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ runner_groups: [{ id: 1 }] })
          )
      )
    ).rejects.toThrow(
      "GitHub runner group response for acme included an invalid group entry"
    );
  });

  test("rejects runner payloads and entries that are malformed", async () => {
    await expect(
      fetchOrganizationRunners(
        "https://api.github.com",
        "acme",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse({ runners: { not: "array" } }))
      )
    ).rejects.toThrow(
      "GitHub runner response for acme did not include runners"
    );

    await expect(
      fetchOrganizationRunners(
        "https://api.github.com",
        "acme",
        "secret",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ runners: [{ id: 1, name: "x" }] })
          )
      )
    ).rejects.toThrow(
      "GitHub runner response for acme included an invalid runner entry"
    );
  });

  test("propagates the status on a non-ok runner-group runner lookup", async () => {
    await expect(
      fetchOrganizationRunnerGroupRunners(
        "https://api.github.com",
        "acme",
        5,
        "secret",
        vi.fn().mockResolvedValue(rawResponse("boom", 500))
      )
    ).rejects.toThrow(
      "GitHub runner group runner lookup failed for acme/5 with 500: boom"
    );
  });

  test("rejects repository payloads that are not arrays and entries without full_name", async () => {
    await expect(
      fetchOrganizationRepositories(
        "https://api.github.com",
        "acme",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse({ nope: true }))
      )
    ).rejects.toThrow(
      "GitHub repository response for acme did not return an array"
    );

    await expect(
      fetchOrganizationRepositories(
        "https://api.github.com",
        "acme",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse([{ id: 1 }]))
      )
    ).rejects.toThrow(
      "GitHub repository response for acme included an invalid repository entry"
    );
  });

  test("rejects workflow run and job payloads that are malformed", async () => {
    await expect(
      fetchQueuedWorkflowRuns(
        "https://api.github.com",
        "example/app",
        "secret",
        vi.fn().mockResolvedValue(rawResponse("down", 503)),
        "in_progress"
      )
    ).rejects.toThrow(
      "GitHub in_progress workflow run lookup failed for example/app with 503: down"
    );

    await expect(
      fetchQueuedWorkflowRuns(
        "https://api.github.com",
        "example/app",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse({ workflow_runs: 1 }))
      )
    ).rejects.toThrow(
      "GitHub workflow run response for example/app did not include workflow_runs"
    );

    await expect(
      fetchWorkflowRunJobs(
        "https://api.github.com/jobs",
        "secret",
        vi.fn().mockResolvedValue(jsonResponse({ jobs: "no" }))
      )
    ).rejects.toThrow("GitHub workflow job response did not include jobs");

    await expect(
      fetchWorkflowRunJobs(
        "https://api.github.com/jobs",
        "secret",
        vi
          .fn()
          .mockResolvedValue(jsonResponse({ jobs: [{ status: "queued" }] }))
      )
    ).rejects.toThrow("GitHub workflow job response included an invalid job entry");
  });

  test("appends pagination params with the correct separator for job URLs", async () => {
    const withQuery = vi
      .fn()
      .mockResolvedValue(jsonResponse({ jobs: [] }));
    await fetchWorkflowRunJobs(
      "https://api.github.com/jobs?filter=latest",
      "secret",
      withQuery
    );
    expect(withQuery).toHaveBeenCalledWith(
      "https://api.github.com/jobs?filter=latest&per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );

    const withoutQuery = vi
      .fn()
      .mockResolvedValue(jsonResponse({ jobs: [] }));
    await fetchWorkflowRunJobs(
      "https://api.github.com/jobs",
      "secret",
      withoutQuery
    );
    expect(withoutQuery).toHaveBeenCalledWith(
      "https://api.github.com/jobs?per_page=100&page=1",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("github runner deletion semantics", () => {
  test("treats a 404 as an already-removed runner", async () => {
    await expect(
      deleteOrganizationRunner(
        "https://api.github.com",
        "example",
        "secret",
        7,
        vi.fn().mockResolvedValue(rawResponse("missing", 404))
      )
    ).resolves.toBe(false);
  });

  test("throws with the status and body on other non-ok deletions", async () => {
    await expect(
      deleteOrganizationRunner(
        "https://api.github.com",
        "example",
        "secret",
        7,
        vi.fn().mockResolvedValue(rawResponse("conflict", 409))
      )
    ).rejects.toThrow(
      "GitHub runner deletion failed for example/7 with 409: conflict"
    );
  });
});

describe("queued job runner-group matching", () => {
  function jobsCountFetch(jobs: unknown[]) {
    return vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          workflow_runs: [
            { id: 1, jobs_url: "https://api.github.com/runs/1/jobs" }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ workflow_runs: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs }));
  }

  const request = {
    organization: "example",
    runnerGroup: "synology-private",
    repositories: ["example/app"],
    labels: ["synology", "shell-only"]
  };

  test("counts only queued jobs whose runner group name matches", async () => {
    await expect(
      getQueuedJobCount(
        "https://api.github.com",
        "secret",
        request,
        jobsCountFetch([
          { id: 1, status: "queued", runner_group_name: "synology-private" },
          { id: 2, status: "queued", runner_group_name: "other-group" },
          { id: 3, status: "in_progress", runner_group_name: "synology-private" }
        ])
      )
    ).resolves.toBe(1);
  });

  test("falls back to label matching only when the group name is absent", async () => {
    await expect(
      getQueuedJobCount(
        "https://api.github.com",
        "secret",
        request,
        jobsCountFetch([
          { id: 1, status: "queued", labels: ["synology", "shell-only", "x"] },
          { id: 2, status: "queued", labels: ["synology"] }
        ])
      )
    ).resolves.toBe(1);
  });

  test("does not match on labels when the request has none", async () => {
    await expect(
      getQueuedJobCount(
        "https://api.github.com",
        "secret",
        { ...request, labels: [] },
        jobsCountFetch([
          { id: 1, status: "queued", labels: ["synology", "shell-only"] }
        ])
      )
    ).resolves.toBe(0);
  });
});

describe("ghcr image reference parsing and lookup", () => {
  test("rejects image references that are not ghcr.io/<owner>/<package>:<tag>", async () => {
    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "docker.io/library/node:20",
        vi.fn()
      )
    ).rejects.toThrow(
      "image reference docker.io/library/node:20 must match ghcr.io/<owner>/<package>:<tag>"
    );
  });

  test("paginates package versions and url-encodes the package name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            metadata: { container: { tags: [`v${index}`] } }
          }))
        )
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 500, metadata: { container: { tags: ["release"] } } }
        ])
      );

    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/acme/team/app:release",
        fetchMock
      )
    ).resolves.toMatchObject({ versionId: 500, ownerType: "orgs" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/orgs/acme/packages/container/team%2Fapp/versions?per_page=100&page=2",
      expect.objectContaining({ method: "GET" })
    );
  });

  test("reports the available tags when the requested tag is missing", async () => {
    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/acme/app:9.9.9",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse([
              { id: 1, metadata: { container: { tags: ["b", "a"] } } }
            ])
          )
      )
    ).rejects.toThrow(
      "GitHub container package acme/app does not include tag 9.9.9; available tags: a, b"
    );
  });

  test("reports that the package was not found across both owner scopes", async () => {
    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/acme/app:1.0.0",
        vi.fn().mockResolvedValue(rawResponse("Not Found", 404))
      )
    ).rejects.toThrow(
      "GitHub container package acme/app was not found for ghcr.io/acme/app:1.0.0"
    );
  });

  test("rejects a non-ok container package response with status and body", async () => {
    await expect(
      verifyContainerImageTag(
        "https://api.github.com",
        "secret",
        "ghcr.io/acme/app:1.0.0",
        vi.fn().mockResolvedValue(rawResponse("server error", 500))
      )
    ).rejects.toThrow(
      "GitHub container package lookup failed for ghcr.io/acme/app:1.0.0 with 500: server error"
    );
  });
});

describe("verify runner groups failure detail", () => {
  test("lists the sorted available group names when a group is missing", async () => {
    await expect(
      verifyRunnerGroups(
        "https://api.github.com",
        "secret",
        [
          {
            poolKey: "synology-private",
            organization: "example",
            runnerGroup: "missing-group"
          }
        ],
        vi.fn().mockResolvedValue(
          jsonResponse({
            runner_groups: [
              { id: 2, name: "zeta", default: false },
              { id: 1, name: "alpha", default: true }
            ]
          })
        )
      )
    ).rejects.toThrow(
      "pool synology-private expects runner group missing-group in organization example, but GitHub returned: alpha, zeta"
    );
  });
});
