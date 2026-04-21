export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  plane?: string;
  pool?: string;
  [key: string]: unknown;
}

export interface LogSink {
  write(chunk: string): boolean;
}

export const log = {
  info: (msg: string, fields: LogFields = {}): void => {
    writeLog("info", msg, fields);
  },
  warn: (msg: string, fields: LogFields = {}): void => {
    writeLog("warn", msg, fields);
  },
  error: (msg: string, fields: LogFields = {}): void => {
    writeLog("error", msg, fields);
  }
};

export function writeLog(
  level: LogLevel,
  msg: string,
  fields: LogFields = {},
  sink: LogSink = process.stderr
): void {
  sink.write(`${stringifyLogEntry(level, msg, fields)}\n`);
}

function stringifyLogEntry(
  level: LogLevel,
  msg: string,
  fields: LogFields
): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    {
      ...fields,
      level,
      msg,
      plane: fields.plane ?? "unknown",
      pool: fields.pool ?? "unknown",
      ts: Date.now()
    },
    (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return value.toString();
      }

      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      }

      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }

      return value;
    }
  );
}
