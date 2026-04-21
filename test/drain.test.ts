import { describe, expect, test, vi } from "vitest";
import { drainRunnerPool } from "../src/lib/drain.js";

describe("runner drain", () => {
  test("cordons idle runners and waits for busy runners to finish", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(runnerGroups())
      .mockResolvedValueOnce(
        runners([
          runner(101, "synology-private-runner-01", false),
          runner(102, "synology-private-runner-02", true)
        ])
      )
      .mockResolvedValueOnce(emptyResponse(204))
      .mockResolvedValueOnce(runnerGroups())
      .mockResolvedValueOnce(
        runners([runner(102, "synology-private-runner-02", false)])
      )
      .mockResolvedValueOnce(emptyResponse(204));
    const progress = vi.fn();

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
        sleep: async () => undefined,
        fetchImpl: fetchMock,
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/orgs/example/actions/runners/101",
      expect.objectContaining({ method: "DELETE" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "https://api.github.com/orgs/example/actions/runners/102",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("is idempotent when configured runners are already absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(runnerGroups())
      .mockResolvedValueOnce(runners([]));

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
  });

  test("returns timeout while runners are still busy", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(runnerGroups())
      .mockResolvedValueOnce(runners([runner(101, "synology-private-runner-01", true)]));

    await expect(
      drainRunnerPool({
        apiUrl: "https://api.github.com",
        token: "secret",
        organization: "example",
        runnerGroup: "synology-private",
        poolKey: "synology-private",
        runnerNames: ["synology-private-runner-01"],
        timeoutSeconds: 0,
        intervalSeconds: 0,
        sleep: async () => undefined,
        fetchImpl: fetchMock
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "timeout",
        busy: ["synology-private-runner-01"]
      })
    );
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
