import { describe, expect, test, vi } from "vitest";
import {
  collectGitHubActualRunnerState,
  compareDesiredActualRunners,
  collectGitHubActualPoolState,
  compareDesiredActualPools,
  desiredPoolsFromConfig
} from "../src/lib/drift.js";
import type { PoolConfig } from "../src/lib/config.js";

describe("drift detection", () => {
  test("reports ok pools when actual online count matches desired size", () => {
    expect(
      compareDesiredActualPools(
        [
          {
            name: "synology-private",
            organization: "example",
            runnerGroup: "synology-private",
            desired: 4
          }
        ],
        [{ name: "synology-private", actual: 4 }]
      )
    ).toEqual({
      pools: [
        {
          name: "synology-private",
          desired: 4,
          actual: 4,
          drift: 0,
          status: "ok"
        }
      ],
      drifted: false
    });
  });

  test("reports under-provisioned and over-provisioned pools beyond threshold", () => {
    expect(
      compareDesiredActualPools(
        [
          {
            name: "synology-private",
            organization: "example",
            runnerGroup: "synology-private",
            desired: 4
          },
          {
            name: "synology-public",
            organization: "example",
            runnerGroup: "synology-public",
            desired: 2
          }
        ],
        [
          { name: "synology-private", actual: 2 },
          { name: "synology-public", actual: 4 }
        ],
        1
      )
    ).toEqual({
      pools: [
        {
          name: "synology-private",
          desired: 4,
          actual: 2,
          drift: -2,
          status: "under-provisioned"
        },
        {
          name: "synology-public",
          desired: 2,
          actual: 4,
          drift: 2,
          status: "over-provisioned"
        }
      ],
      drifted: true
    });
  });

  test("treats missing actual pools as zero online runners", () => {
    expect(
      compareDesiredActualPools(
        [
          {
            name: "linux-private",
            organization: "example",
            runnerGroup: "linux-private",
            desired: 1
          }
        ],
        []
      )
    ).toEqual({
      pools: [
        {
          name: "linux-private",
          desired: 1,
          actual: 0,
          drift: -1,
          status: "under-provisioned"
        }
      ],
      drifted: true
    });
  });

  test("builds desired pool state from resolved Synology config", () => {
    const pools = [
      {
        key: "synology-private",
        organization: "example",
        runnerGroup: "private-group",
        size: 3
      }
    ] as PoolConfig[];

    expect(desiredPoolsFromConfig(pools)).toEqual([
      {
        name: "synology-private",
        organization: "example",
        runnerGroup: "private-group",
        desired: 3
      }
    ]);
  });

  test("counts only online GitHub runners assigned to the expected group", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runner_groups: [
              { id: 10, name: "synology-private", default: false },
              { id: 11, name: "other", default: false }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runners: [
              {
                id: 1,
                name: "runner-1",
                status: "online"
              },
              {
                id: 2,
                name: "runner-2",
                status: "offline"
              }
            ]
          })
      });

    await expect(
      collectGitHubActualPoolState(
        "https://api.github.com",
        "secret",
        [
          {
            name: "synology-private",
            organization: "example",
            runnerGroup: "synology-private",
            desired: 2
          }
        ],
        fetchMock
      )
    ).resolves.toEqual([{ name: "synology-private", actual: 1 }]);
  });

  test("diffs missing, stale, and changed runner registrations", () => {
    expect(
      compareDesiredActualRunners(
        [
          {
            plane: "synology",
            poolKey: "synology-private",
            organization: "example",
            name: "synology-private-runner-01",
            runnerGroup: "synology-private",
            labels: ["synology", "shell-only", "private"]
          },
          {
            plane: "synology",
            poolKey: "synology-private",
            organization: "example",
            name: "synology-private-runner-02",
            runnerGroup: "synology-private",
            labels: ["synology", "shell-only", "private"]
          }
        ],
        [
          {
            id: 1,
            organization: "example",
            name: "synology-private-runner-01",
            runnerGroup: "wrong-group",
            labels: ["self-hosted", "synology", "private", "old-label"],
            status: "online"
          },
          {
            id: 3,
            organization: "example",
            name: "synology-private-runner-old",
            runnerGroup: "synology-private",
            labels: ["self-hosted", "synology", "private"],
            status: "offline"
          }
        ]
      )
    ).toEqual({
      inSync: false,
      added: [
        {
          organization: "example",
          name: "synology-private-runner-02",
          plane: "synology",
          poolKey: "synology-private",
          runnerGroup: "synology-private",
          labels: ["private", "shell-only", "synology"]
        }
      ],
      removed: [
        {
          id: 3,
          organization: "example",
          name: "synology-private-runner-old",
          runnerGroup: "synology-private",
          labels: ["private", "self-hosted", "synology"],
          status: "offline"
        }
      ],
      changed: [
        {
          organization: "example",
          name: "synology-private-runner-01",
          plane: "synology",
          poolKey: "synology-private",
          runnerGroup: "synology-private",
          labels: ["private", "shell-only", "synology"],
          actualRunnerGroup: "wrong-group",
          actualLabels: ["old-label", "private", "self-hosted", "synology"],
          missingLabels: ["shell-only"],
          unexpectedLabels: ["old-label"]
        }
      ]
    });
  });

  test("collects registered runners with runner group names for config diff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runner_groups: [{ id: 10, name: "synology-private" }]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            runners: [
              {
                id: 1,
                name: "synology-private-runner-01",
                status: "online",
                runner_group_id: 10,
                labels: [{ name: "self-hosted" }, { name: "synology" }]
              }
            ]
          })
      });

    await expect(
      collectGitHubActualRunnerState(
        "https://api.github.com",
        "secret",
        [
          {
            plane: "synology",
            poolKey: "synology-private",
            organization: "example",
            name: "synology-private-runner-01",
            runnerGroup: "synology-private",
            labels: ["synology"]
          }
        ],
        fetchMock
      )
    ).resolves.toEqual([
      {
        id: 1,
        organization: "example",
        name: "synology-private-runner-01",
        runnerGroup: "synology-private",
        labels: ["self-hosted", "synology"],
        status: "online"
      }
    ]);
  });
});
