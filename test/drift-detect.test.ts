import { describe, expect, test, vi } from "vitest";
import {
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
                status: "online",
                runner_group_id: 10
              },
              {
                id: 2,
                name: "runner-2",
                status: "offline",
                runner_group_id: 10
              },
              {
                id: 3,
                name: "runner-3",
                status: "online",
                runner_group_id: 11
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
});
