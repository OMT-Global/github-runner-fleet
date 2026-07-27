import fs from "node:fs";
import path from "node:path";

export const DEFAULT_AUDIT_LOG_FILE = "/var/log/runner-fleet/audit.jsonl";

export const AUDIT_EVENTS = [
  "runner_registered",
  "runner_job_start",
  "runner_deregistered",
  "runner_evicted",
  "token_fetch_failed",
  "runner_token_rotated"
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export interface AuditRecord {
  ts: string;
  event: AuditEvent;
  runner_name: string;
  pool: string;
  plane: string;
  org: string;
  runner_id?: number;
  container_id?: string;
  [key: string]: unknown;
}

export interface WriteAuditRecordOptions {
  filePath?: string;
  maxSizeBytes?: number;
  now?: Date;
}

export interface AuditLogHealth {
  status: "missing" | "unwritable" | "stale" | "healthy";
  filePath: string;
  sizeBytes: number;
  ageSeconds?: number;
  detail: string;
}

export function auditLogFileFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  return env.AUDIT_LOG_FILE?.trim() || DEFAULT_AUDIT_LOG_FILE;
}

export function auditMaxSizeBytesFromEnv(
  env: Record<string, string | undefined> = process.env
): number | undefined {
  const value = env.AUDIT_LOG_MAX_SIZE_BYTES?.trim();
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid AUDIT_LOG_MAX_SIZE_BYTES value "${value}"`);
  }
  return parsed;
}

export function normalizeAuditRecord(
  input: unknown,
  now = new Date()
): AuditRecord {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("audit record must be a JSON object");
  }

  const source = input as Record<string, unknown>;
  const event = source.event;
  if (!isAuditEvent(event)) {
    throw new Error(`unsupported audit event: ${String(event)}`);
  }

  const record: AuditRecord = {
    ...source,
    ts: typeof source.ts === "string" && source.ts ? source.ts : now.toISOString(),
    event,
    runner_name: requireString(source.runner_name, "runner_name"),
    pool: requireString(source.pool, "pool"),
    plane: requireString(source.plane, "plane"),
    org: requireString(source.org, "org")
  };

  if (source.runner_id !== undefined) {
    if (
      typeof source.runner_id !== "number" ||
      !Number.isSafeInteger(source.runner_id)
    ) {
      throw new Error("runner_id must be an integer when provided");
    }
    record.runner_id = source.runner_id;
  }

  if (source.container_id !== undefined) {
    record.container_id = requireString(source.container_id, "container_id");
  }

  return record;
}

export function writeAuditRecord(
  input: unknown,
  options: WriteAuditRecordOptions = {}
): AuditRecord {
  const record = normalizeAuditRecord(input, options.now);
  const filePath = options.filePath ?? auditLogFileFromEnv();
  const line = `${JSON.stringify(record)}\n`;
  withAuditLock(filePath, () => {
    rotateAuditLogIfNeeded(filePath, Buffer.byteLength(line), options.maxSizeBytes);
    appendLineSync(filePath, line);
  });
  return record;
}

export function inspectAuditLog(
  filePath: string,
  staleAfterSeconds = 86_400,
  now = Date.now()
): AuditLogHealth {
  if (!fs.existsSync(filePath)) {
    const parent = nearestExistingParent(path.dirname(filePath));
    try {
      fs.accessSync(parent, fs.constants.W_OK);
    } catch {
      return { status: "unwritable", filePath, sizeBytes: 0, detail: `audit log is absent and parent ${parent} is not writable` };
    }
    return { status: "missing", filePath, sizeBytes: 0, detail: "audit log has not been created" };
  }
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
  } catch {
    return { status: "unwritable", filePath, sizeBytes: fs.statSync(filePath).size, detail: "audit log is not writable" };
  }
  const stat = fs.statSync(filePath);
  const ageSeconds = Math.max(0, Math.floor((now - stat.mtimeMs) / 1000));
  if (stat.size === 0 || ageSeconds > staleAfterSeconds) {
    return {
      status: "stale",
      filePath,
      sizeBytes: stat.size,
      ageSeconds,
      detail: stat.size === 0 ? "audit log is empty" : `last audit write ${ageSeconds}s ago exceeds ${staleAfterSeconds}s threshold`
    };
  }
  return { status: "healthy", filePath, sizeBytes: stat.size, ageSeconds, detail: `size ${stat.size} bytes; last write ${ageSeconds}s ago` };
}

export async function readJsonFromStdin(
  stdin: NodeJS.ReadableStream = process.stdin
): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("audit-log requires a JSON record on stdin");
  }
  return JSON.parse(raw);
}

function rotateAuditLogIfNeeded(
  filePath: string,
  nextBytes: number,
  maxSizeBytes: number | undefined
): void {
  if (maxSizeBytes === undefined || !fs.existsSync(filePath)) {
    return;
  }

  const currentBytes = fs.statSync(filePath).size;
  if (currentBytes + nextBytes <= maxSizeBytes) {
    return;
  }

  const rotatedPath = `${filePath}.1`;
  fs.rmSync(rotatedPath, { force: true });
  fs.renameSync(filePath, rotatedPath);
}

function appendLineSync(filePath: string, line: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "a", 0o600);
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function withAuditLock<T>(filePath: string, callback: () => T): T {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`timed out acquiring audit rotation lock ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function nearestExistingParent(start: string): string {
  let current = start;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return typeof value === "string" && AUDIT_EVENTS.includes(value as AuditEvent);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}
