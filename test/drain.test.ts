import { describe, expect, test, vi } from "vitest";
import { drainRunnerPool } from "../src/lib/drain.js";

describe("runner drain", () => {
  test("cordons idle runners and waits for busy runners to finish", async () => {
    let inventory = [
      runner(101, "synology-private-runner-01", false),
      runner(102, "synology-private-runner-02", true)
    ];
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (url.includes("runner-groups")) return runnerGroups();
      if (init?.method === "DELETE") {
        const id = Number(url.split("/").at(-1));
        inventory = inventory.filter((entry) => entry.id !== id);
        if (id === 101) {
          inventory.push(runner(201, "synology-private-runner-01", false));
        }
        return emptyResponse(204);
      }
      return runners(inventory);
    });
    const progress = vi.fn();
    const quiesce = vi.fn(async () => undefined);
    let sleeps = 0;

    await expect(
      drainRunnerPool({
        apiUrl: "https://api.github.com",
        token: "secret",
        organization: "example",
        runnerGroup: "synology-private",
        poolKey: "synology-private",
        runnerNames: [
          "synology-private-runner-01",
          "synology-private-runner-02"
        ],
        timeoutSeconds: 30,
        intervalSeconds: 0,
        sleep: async () => {
          sleeps += 1;
          if (sleeps === 1) {
            inventory = inventory.map((entry) =>
              entry.id === 102
                ? runner(102, "synology-private-runner-02", false)
                : entry
            );
          }
        },
        fetchImpl: fetchMock,
        onQuiesce: quiesce,
        onProgress: progress
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "drained",
        cordoned: [
          "synology-private-runner-01",
          "synology-private-runner-02"
        ],
        busy: []
      })
    );

    expect(progress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "waiting",
        busy: ["synology-private-runner-02"],
        cordoned: ["synology-private-runner-01"]
      })
    );
    expect(quiesce.mock.calls.map(([entry]) => entry.id).sort()).toEqual([
      101,
      102,
      201
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("actions/runners?"))
    ).toHaveLength(4);
  });

  test("is idempotent when configured runners are already absent", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("runner-groups") ? runnerGroups() : runners([])
    );

    await expect(
      drainRunnerPool({
        apiUrl: "https://api.github.com",
        token: "secret",
        organization: "example",
        runnerGroup: "synology-private",
        poolKey: "synology-private",
        runnerNames: ["synology-private-runner-01"],
        timeoutSeconds: 30,
        intervalSeconds: 0,
        sleep: async () => undefined,
        fetchImpl: fetchMock
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "drained",
        cordoned: [],
        missing: ["synology-private-runner-01"]
      })
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("actions/runners?"))
    ).toHaveLength(2);
  });

  test("returns timeout while runners are still busy", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("runner-groups")
        ? runnerGroups()
        : runners([runner(101, "synology-private-runner-01", true)])
    );
    let now = 0;

    await expect(
      drainRunnerPool({
        apiUrl: "https://api.github.com",
        token: "secret",
        organization: "example",
        runnerGroup: "synology-private",
        poolKey: "synology-private",
        runnerNames: ["synology-private-runner-01"],
        timeoutSeconds: 1,
        intervalSeconds: 5,
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        },
        fetchImpl: fetchMock
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "timeout",
        busy: ["synology-private-runner-01"]
      })
    );
    expect(now).toBe(1000);
  });
});

function runnerGroups() {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        runner_groups: [{ id: 7, name: "synology-private" }]
      })
  };
}

function runners(entries: unknown[]) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ runners: entries })
  };
}

function runner(id: number, name: string, busy: boolean) {
  return {
    id,
    name,
    status: busy ? "online" : "offline",
    busy,
    runner_group_id: 7,
    labels: [{ name: "self-hosted" }]
  };
}

function emptyResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => ""
  };
}
