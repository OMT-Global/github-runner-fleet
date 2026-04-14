import { describe, expect, test, vi } from "vitest";
import {
  buildRegistrationTokenRequest,
  buildRemoveTokenRequest,
  fetchOrganizationRunnerGroups,
  fetchLatestRunnerRelease,
  fetchRunnerToken,
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
