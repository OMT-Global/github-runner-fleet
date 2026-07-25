import fs from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  auditLogFileFromEnv,
  inspectAuditLog,
  normalizeAuditRecord,
  writeAuditRecord
} from "../src/lib/audit.js";

const tempPaths: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("audit log", () => {
  test("appends normalized JSON records and fsyncs the audit file", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    const now = new Date("2026-04-19T12:00:00.000Z");
    const fsync = vi.spyOn(fs, "fsyncSync").mockImplementation(() => undefined);

    const record = writeAuditRecord(
      {
        event: "runner_registered",
        runner_name: "synology-private-runner-02",
        pool: "synology-private",
        plane: "synology",
        runner_id: 123456,
        org: "omt-global",
        container_id: "abc123"
      },
      { filePath, now }
    );

    expect(record.ts).toBe("2026-04-19T12:00:00.000Z");
    expect(readJsonLines(filePath)).toEqual([
      {
        ts: "2026-04-19T12:00:00.000Z",
        event: "runner_registered",
        runner_name: "synology-private-runner-02",
        pool: "synology-private",
        plane: "synology",
        runner_id: 123456,
        org: "omt-global",
        container_id: "abc123"
      }
    ]);
    expect(fsync).toHaveBeenCalledTimes(1);
  });

  test("rotates before append when the next record exceeds max size", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    fs.writeFileSync(filePath, `${JSON.stringify({ old: true })}\n`, "utf8");

    writeAuditRecord(
      {
        event: "runner_deregistered",
        runner_name: "synology-private-runner-01",
        pool: "synology-private",
        plane: "synology",
        org: "omt-global"
      },
      {
        filePath,
        maxSizeBytes: fs.statSync(filePath).size + 1,
        now: new Date("2026-04-19T12:00:00.000Z")
      }
    );

    expect(readJsonLines(`${filePath}.1`)).toEqual([{ old: true }]);
    expect(readJsonLines(filePath)).toEqual([
      expect.objectContaining({
        event: "runner_deregistered",
        runner_name: "synology-private-runner-01"
      })
    ]);
  });

  test("keeps concurrent append attempts as complete JSONL records", async () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => undefined);

    await Promise.all(
      Array.from({ length: 25 }, async (_value, index) => {
        writeAuditRecord(
          {
            event: "runner_job_start",
            runner_name: `runner-${index}`,
            pool: "synology-private",
            plane: "synology",
            org: "omt-global"
          },
          { filePath, now: new Date("2026-04-19T12:00:00.000Z") }
        );
      })
    );

    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(25);
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runner_name: "runner-0" }),
        expect.objectContaining({ runner_name: "runner-24" })
      ])
    );
  });

  test("validates the event schema and environment defaults", () => {
    expect(() =>
      normalizeAuditRecord({
        event: "not-real",
        runner_name: "runner",
        pool: "pool",
        plane: "synology",
        org: "omt-global"
      })
    ).toThrow("unsupported audit event");
    expect(auditLogFileFromEnv({})).toBe("/var/log/runner-fleet/audit.jsonl");
    expect(auditLogFileFromEnv({ AUDIT_LOG_FILE: "/tmp/audit.jsonl" })).toBe(
      "/tmp/audit.jsonl"
    );
  });

  test("distinguishes missing, empty, stale, and healthy logs", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    expect(inspectAuditLog(filePath)).toMatchObject({ status: "missing" });
    fs.writeFileSync(filePath, "", "utf8");
    expect(inspectAuditLog(filePath)).toMatchObject({ status: "stale", detail: "audit log is empty" });
    fs.writeFileSync(filePath, "{}\n", "utf8");
    fs.utimesSync(filePath, new Date(0), new Date(0));
    expect(inspectAuditLog(filePath, 60, 120_000)).toMatchObject({ status: "stale", ageSeconds: 120 });
    expect(inspectAuditLog(filePath, 300, 120_000)).toMatchObject({ status: "healthy" });
  });

  test("serializes rotation across independent writer processes", async () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    fs.writeFileSync(filePath, `${JSON.stringify({ old: "x".repeat(8_800) })}\n`, "utf8");
    await Promise.all(Array.from({ length: 8 }, (_value, index) =>
      spawnAuditWriter(filePath, index)
    ));

    const records = [filePath, `${filePath}.1`]
      .filter((entry) => fs.existsSync(entry))
      .flatMap((entry) => readJsonLines(entry));
    expect(records).toHaveLength(9);
    expect(records).toEqual(expect.arrayContaining(
      Array.from({ length: 8 }, (_value, index) => expect.objectContaining({ runner_name: `process-${index}` }))
    ));
  });

  test("recovers the audit write when a stale lock older than 30s is present", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    const lockPath = `${filePath}.lock`;
    fs.mkdirSync(lockPath);
    const realStatSync = fs.statSync.bind(fs);
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file) === lockPath) {
        return { mtimeMs: 0 } as fs.Stats;
      }
      return (realStatSync as (f: fs.PathLike, ...args: unknown[]) => fs.Stats)(file, ...(rest as [fs.StatOptions]));
    }) as unknown as typeof fs.statSync);

    try {
      const record = writeAuditRecord(
        {
          event: "runner_token_rotated",
          runner_name: "synology-private-runner-03",
          pool: "synology-private",
          plane: "synology",
          org: "omt-global"
        },
        { filePath }
      );
      expect(record.runner_name).toBe("synology-private-runner-03");
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(readJsonLines(filePath)).toEqual([
        expect.objectContaining({ runner_name: "synology-private-runner-03" })
      ]);
    } finally {
      statSpy.mockRestore();
    }
  });

  test("times out if the audit lock is held fresh beyond the 30s deadline", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    const lockPath = `${filePath}.lock`;
    fs.mkdirSync(lockPath);
    const BASE = 1_000_000;
    let calls = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? BASE : BASE + 45_000;
    });
    const realStatSync = fs.statSync.bind(fs);
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation(((file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file) === lockPath) {
        return { mtimeMs: BASE + 45_000 } as fs.Stats;
      }
      return (realStatSync as (f: fs.PathLike, ...args: unknown[]) => fs.Stats)(file, ...(rest as [fs.StatOptions]));
    }) as unknown as typeof fs.statSync);

    try {
      expect(() =>
        writeAuditRecord(
          {
            event: "runner_token_rotated",
            runner_name: "synology-private-runner-04",
            pool: "synology-private",
            plane: "synology",
            org: "omt-global"
          },
          { filePath }
        )
      ).toThrow(/timed out acquiring audit rotation lock/);
    } finally {
      nowSpy.mockRestore();
      statSpy.mockRestore();
    }
  });
});

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
  tempPaths.push(directory);
  return directory;
}

function spawnAuditWriter(filePath: string, index: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx", "src/cli.ts", "audit-log",
      "--file", filePath, "--max-size-bytes", "10000"
    ], { cwd: path.resolve("."), stdio: ["pipe", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`audit writer exited ${code}: ${error}`)));
    child.stdin.end(JSON.stringify({
      event: "runner_job_start",
      runner_name: `process-${index}`,
      pool: "synology-private",
      plane: "synology",
      org: "omt-global"
    }));
  });
}

function readJsonLines(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
