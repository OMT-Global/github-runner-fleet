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
    await runAuditWriters(filePath, 8);

    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
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

  test("writes after fresh lock contention lasts longer than 5s but releases before 30s", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    const lockPath = `${filePath}.lock`;
    const BASE = 1_000_000;
    fs.mkdirSync(lockPath);
    fs.utimesSync(lockPath, new Date(BASE), new Date(BASE));
    const nowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(BASE)
      .mockReturnValue(BASE + 6_000);
    const waitSpy = vi.spyOn(Atomics, "wait").mockImplementation(() => {
      fs.rmSync(lockPath, { recursive: true, force: true });
      return "ok";
    });

    try {
      const record = writeAuditRecord(
        {
          event: "runner_token_rotated",
          runner_name: "synology-private-runner-04",
          pool: "synology-private",
          plane: "synology",
          org: "omt-global"
        },
        { filePath }
      );

      expect(record.runner_name).toBe("synology-private-runner-04");
      expect(waitSpy).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(readJsonLines(filePath)).toEqual([
        expect.objectContaining({ runner_name: "synology-private-runner-04" })
      ]);
    } finally {
      nowSpy.mockRestore();
      waitSpy.mockRestore();
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

async function runAuditWriters(filePath: string, count: number): Promise<void> {
  const writers = Array.from({ length: count }, (_value, index) => {
    const child = spawn(process.execPath, [
      "--import", "tsx", "test/fixtures/audit-writer.ts", filePath, String(index)
    ], { cwd: path.resolve("."), stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let error = "";
    child.stderr!.on("data", (chunk) => { error += String(chunk); });
    child.on("error", (cause) => { error += cause.message; });
    const ready = new Promise<void>((resolve, reject) => {
      child.once("message", (message) => {
        if (message === "ready") resolve();
        else reject(new Error(`unexpected audit writer message: ${String(message)}`));
      });
      child.once("close", () => reject(new Error(`audit writer ${index} closed before ready: ${error}`)));
    });
    const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
    return { child, ready, closed, failure: () => new Error(`audit writer ${index} failed: ${error}`) };
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        // Finish imports in every process before releasing the concurrent writes.
        await Promise.all(writers.map((writer) => writer.ready));
        await Promise.all(writers.map(({ child }) => new Promise<void>((resolve, reject) => {
          child.send("write", (error) => error ? reject(error) : resolve());
        })));
        await Promise.all(writers.map(async (writer) => {
          if (await writer.closed !== 0) throw writer.failure();
        }));
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("audit writers did not finish within 25000ms")), 25_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
    for (const { child } of writers) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    // Reap failed or timed-out writers before afterEach removes their directory.
    await Promise.all(writers.map((writer) => writer.closed));
  }
}

function readJsonLines(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
