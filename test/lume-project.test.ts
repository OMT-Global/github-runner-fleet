import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ResolvedLumeConfig } from "../src/lib/lume-config.js";
import {
  buildLumeProjectResult,
  defaultLumeProjectLogFile,
  defaultLumeProjectPidFile,
  defaultLumeProjectResultPath,
  formatLumeProjectResultText,
  loadLumeProjectResult,
  saveLumeProjectResult
} from "../src/lib/lume-project.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("lume project result artifacts", () => {
  test("saves, loads, and formats supervisor and drain state", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lume-project-test-"));
    tempPaths.push(directory);
    const config = createResolvedLumeConfig(directory);
    const resultPath = defaultLumeProjectResultPath(config);

    expect(defaultLumeProjectPidFile(config)).toBe(
      path.join(directory, "lume-project.pid")
    );
    expect(defaultLumeProjectLogFile(config)).toBe(
      path.join(directory, "logs", "lume-project.log")
    );
    expect(loadLumeProjectResult(resultPath)).toBeUndefined();

    const result = buildLumeProjectResult({
      action: "teardown",
      status: "stopped",
      config,
      resultPath,
      supervisorPid: 42,
      drain: {
        status: "drained",
        cordoned: ["macos-runner-slot-01"],
        busy: [],
        missing: ["macos-runner-slot-02"]
      }
    });

    saveLumeProjectResult(result);

    expect(loadLumeProjectResult(resultPath)).toEqual(result);
    expect(formatLumeProjectResultText(result)).toContain(
      "supervisor_pid=42"
    );
    expect(formatLumeProjectResultText(result)).toContain(
      "drain=drained cordoned=1 busy=0 missing=1"
    );
  });
});

function createResolvedLumeConfig(baseDir: string): ResolvedLumeConfig {
  return {
    version: 1,
    host: {
      baseDir,
      configPath: path.join(baseDir, "lume-runners.yaml"),
      envFile: path.join(baseDir, "runner.env")
    },
    pool: {
      key: "macos-private",
      organization: "example",
      runnerGroup: "macos-private",
      labels: ["self-hosted", "macos", "arm64", "private"],
      size: 1,
      vmBaseName: "macos-runner-base",
      vmSlotPrefix: "macos-runner-slot",
      cpu: 6,
      memory: "14GB",
      diskSize: "80GB",
      network: "nat",
      guestUser: "lume",
      guestPassword: "lume",
      guestRunnerRoot: "/Users/lume/actions-runner",
      guestWorkRoot: "/Users/lume/actions-runner/_work",
      runnerVersion: "2.333.0"
    },
    slots: [
      {
        index: 1,
        slotKey: "slot-01",
        vmName: "macos-runner-slot-01",
        runnerName: "macos-runner-slot-01",
        runnerLabels: "self-hosted,macos,arm64,private",
        hostDir: path.join(baseDir, "slots", "slot-01"),
        workerPidFile: path.join(baseDir, "slots", "slot-01", "worker.pid"),
        vmPidFile: path.join(baseDir, "slots", "slot-01", "vm.pid"),
        workerLogFile: path.join(baseDir, "logs", "slot-01.log"),
        vmLogFile: path.join(baseDir, "logs", "slot-01-vm.log"),
        guestStageDir: "/tmp/github-runner-fleet",
        guestBootstrapPath: "/tmp/github-runner-fleet/macos-runner-bootstrap.sh",
        guestHelperPath: "/tmp/github-runner-fleet/github-runner-common.sh",
        guestEnvPath: "/tmp/github-runner-fleet/runner.env"
      }
    ]
  };
}
