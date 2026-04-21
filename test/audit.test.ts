import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  auditLogFileFromEnv,
  normalizeAuditRecord,
  writeAuditRecord
} from "../src/lib/audit.js";

const tempPaths: string[] = [];

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("audit log", () => {
  test("appends normalized JSON records and fsyncs the audit file", () => {
    const directory = createTempDir();
    const filePath = path.join(directory, "audit.jsonl");
    const now = new Date("2026-04-19T12:00:00.000Z");

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
});

function createTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
  tempPaths.push(directory);
  return directory;
}

function readJsonLines(filePath: string): unknown[] {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
