import { describe, expect, test, vi } from "vitest";
import { pruneStaleRunners } from "../src/lib/prune.js";

describe("stale runner pruning", () => {
  test("reports offline unexpected runners without deleting by default", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ runner_groups: runnerGroups() }))
      .mockResolvedValueOnce(
        jsonResponse({
          runners: [
            runner(101, "synology-private-runner-01", "online", false),
            runner(102, "synology-private-runner-02", "offline", false),
            runner(103, "synology-private-runner-old", "offline", false),
            runner(104, "synology-private-runner-busy", "offline", true),
            runner(105, "synology-private-runner-live", "online", false)
          ]
        })
      );

    const report = await pruneStaleRunners({
      apiUrl: "https://api.github.test",
      token: "token",
      pools: [
        {
          plane: "synology",
          key: "synology-private",
          organization: "example",
          runnerGroup: "synology-private",
          runnerNames: [
            "synology-private-runner-01",
            "synology-private-runner-02"
          ]
        }
      ],
      apply: false,
      fetchImpl
    });

    expect(report).toEqual({
      apply: false,
      groups: [
        {
          plane: "synology",
          poolKey: "synology-private",
          organization: "example",
          runnerGroup: "synology-private",
          expected: [
            "synology-private-runner-01",
            "synology-private-runner-02"
          ],
          scanned: 5
        }
      ],
      stale: [
        {
          plane: "synology",
          poolKey: "synology-private",
          organization: "example",
          runnerGroup: "synology-private",
          id: 103,
          name: "synology-private-runner-old",
          status: "offline",
          busy: false
        }
      ],
      deleted: []
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("deletes only safe stale runners when apply is enabled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ runner_groups: runnerGroups() }))
      .mockResolvedValueOnce(
        jsonResponse({
          runners: [
            runner(201, "synology-private-runner-01", "offline", false),
            runner(202, "synology-private-runner-old", "offline", false),
            runner(203, "synology-private-runner-live", "online", false),
            runner(204, "synology-private-runner-busy", "offline", true)
          ]
        })
      )
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" });

    const report = await pruneStaleRunners({
      apiUrl: "https://api.github.test",
      token: "token",
      pools: [
        {
          plane: "synology",
          key: "synology-private",
          organization: "example",
          runnerGroup: "synology-private",
          runnerNames: ["synology-private-runner-01"]
        }
      ],
      apply: true,
      fetchImpl
    });

    expect(report.stale).toEqual([
      expect.objectContaining({
        id: 202,
        name: "synology-private-runner-old",
        deleted: true
      })
    ]);
    expect(report.deleted).toEqual(["synology-private-runner-old"]);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://api.github.test/orgs/example/actions/runners/202",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("unions expected names when multiple pools share a runner group", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ runner_groups: runnerGroups() }))
      .mockResolvedValueOnce(
        jsonResponse({
          runners: [
            runner(301, "pool-a-runner-01", "offline", false),
            runner(302, "pool-b-runner-01", "offline", false),
            runner(303, "old-runner", "offline", false)
          ]
        })
      );

    const report = await pruneStaleRunners({
      apiUrl: "https://api.github.test",
      token: "token",
      pools: [
        {
          plane: "synology",
          key: "pool-a",
          organization: "example",
          runnerGroup: "synology-private",
          runnerNames: ["pool-a-runner-01"]
        },
        {
          plane: "linux-docker",
          key: "pool-b",
          organization: "example",
          runnerGroup: "synology-private",
          runnerNames: ["pool-b-runner-01"]
        }
      ],
      apply: false,
      fetchImpl
    });

    expect(report.groups).toEqual([
      expect.objectContaining({
        plane: "linux-docker,synology",
        poolKey: "pool-a,pool-b",
        expected: ["pool-a-runner-01", "pool-b-runner-01"],
        scanned: 3
      })
    ]);
    expect(report.stale.map((runner) => runner.name)).toEqual(["old-runner"]);
  });

  test("reports none when GitHub returns no expected runner groups", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ runner_groups: [] }))
      .mockResolvedValueOnce(jsonResponse({ runners: [] }));

    await expect(
      pruneStaleRunners({
        apiUrl: "https://api.github.test",
        token: "token",
        pools: [
          {
            plane: "synology",
            key: "synology-private",
            organization: "example",
            runnerGroup: "synology-private",
            runnerNames: ["synology-private-runner-01"]
          }
        ],
        apply: false,
        fetchImpl
      })
    ).rejects.toThrow(
      "pool synology-private expects runner group synology-private in organization example, but GitHub returned: none"
    );
  });
});

function runnerGroups() {
  return [{ id: 7, name: "synology-private", default: false }];
}

function runner(
  id: number,
  name: string,
  status: "online" | "offline",
  busy: boolean
) {
  return {
    id,
    name,
    status,
    busy,
    runner_group_id: 7,
    labels: [{ name: "self-hosted" }]
  };
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload)
  };
}
