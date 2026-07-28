import { describe, expect, test, vi } from "vitest";
import {
  inspectRunnerGroupAccess,
  reconcileRunnerGroupAccess,
  type RunnerGroupAccessExpectation
} from "../src/lib/runner-group-access.js";

const privateExpectation: RunnerGroupAccessExpectation = {
  poolKey: "synology-private",
  organization: "omt-global",
  runnerGroup: "synology-private",
  repositoryAccess: "selected",
  allowedRepositories: ["omt-global/omtcornercave.org"],
  allowsPublicRepositories: false
};

describe("runner group repository access reconciliation", () => {
  test("accepts an exact selected-repository assignment case-insensitively", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groupResponse("selected", false))
      .mockResolvedValueOnce(
        repositoryListResponse([
          {
            id: 41,
            full_name: "OMT-Global/omtcornercave.org",
            private: true
          }
        ])
      );

    await expect(
      inspectRunnerGroupAccess(
        "https://api.github.com",
        "secret",
        [privateExpectation],
        fetchMock
      )
    ).resolves.toEqual([
      expect.objectContaining({
        poolKey: "synology-private",
        policyMatches: true,
        missingRepositories: [],
        unexpectedRepositories: [],
        ok: true
      })
    ]);
  });

  test("reports missing and unexpected repository assignments", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groupResponse("selected", false))
      .mockResolvedValueOnce(
        repositoryListResponse([
          {
            id: 42,
            full_name: "OMT-Global/unexpected",
            private: true
          }
        ])
      );

    const [status] = await inspectRunnerGroupAccess(
      "https://api.github.com",
      "secret",
      [privateExpectation],
      fetchMock
    );

    expect(status).toMatchObject({
      missingRepositories: ["omt-global/omtcornercave.org"],
      unexpectedRepositories: ["OMT-Global/unexpected"],
      ok: false
    });
  });

  test("adds only missing repositories and verifies the resulting state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groupResponse("selected", false))
      .mockResolvedValueOnce(repositoryListResponse([]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 41,
            full_name: "OMT-Global/omtcornercave.org",
            private: true
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => ""
      })
      .mockResolvedValueOnce(groupResponse("selected", false))
      .mockResolvedValueOnce(
        repositoryListResponse([
          {
            id: 41,
            full_name: "OMT-Global/omtcornercave.org",
            private: true
          }
        ])
      );

    const report = await reconcileRunnerGroupAccess(
      "https://api.github.com",
      "secret",
      [privateExpectation],
      true,
      fetchMock
    );

    expect(report).toMatchObject({
      apply: true,
      ok: true,
      addedRepositories: [
        {
          poolKey: "synology-private",
          repository: "omt-global/omtcornercave.org"
        }
      ],
      blockedPolicyDrift: []
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.github.com/orgs/omt-global/actions/runner-groups/3/repositories/41",
      expect.objectContaining({ method: "PUT" })
    );
  });

  test("fails closed when runner-group policy differs from configuration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groupResponse("selected", true))
      .mockResolvedValueOnce(repositoryListResponse([]));

    const report = await reconcileRunnerGroupAccess(
      "https://api.github.com",
      "secret",
      [privateExpectation],
      true,
      fetchMock
    );

    expect(report.ok).toBe(false);
    expect(report.addedRepositories).toEqual([]);
    expect(report.blockedPolicyDrift).toEqual([
      expect.objectContaining({
        poolKey: "synology-private",
        expectedAllowsPublicRepositories: false,
        actualAllowsPublicRepositories: true
      })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects stale repository aliases instead of assigning the redirect target", async () => {
    const expectation = {
      ...privateExpectation,
      allowedRepositories: ["omt-global/old-name"]
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groupResponse("selected", false))
      .mockResolvedValueOnce(repositoryListResponse([]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 51,
            full_name: "OMT-Global/new-name",
            private: true
          })
      });

    await expect(
      reconcileRunnerGroupAccess(
        "https://api.github.com",
        "secret",
        [expectation],
        true,
        fetchMock
      )
    ).rejects.toThrow(
      /configured repository omt-global\/old-name resolves to OMT-Global\/new-name/
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function groupResponse(
  visibility: "all" | "selected",
  allowsPublicRepositories: boolean
) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        runner_groups: [
          {
            id: 3,
            name: "synology-private",
            visibility,
            default: false,
            allows_public_repositories: allowsPublicRepositories
          }
        ]
      })
  };
}

function repositoryListResponse(
  repositories: Array<{
    id: number;
    full_name: string;
    private: boolean;
  }>
) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ repositories })
  };
}
