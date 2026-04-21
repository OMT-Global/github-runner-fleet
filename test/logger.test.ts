import { describe, expect, test, vi } from "vitest";
import { writeLog } from "../src/lib/logger.js";

describe("structured logger", () => {
  test("writes parseable JSON lines with the requested level", () => {
    const chunks: string[] = [];
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_774_000_000_000);

    writeLog(
      "warn",
      "pool capacity is low",
      {
        plane: "lume",
        pool: "macos-private",
        available: 1
      },
      {
        write: (chunk) => {
          chunks.push(chunk);
          return true;
        }
      }
    );

    nowSpy.mockRestore();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatch(/\n$/);
    expect(JSON.parse(chunks[0])).toEqual({
      level: "warn",
      msg: "pool capacity is low",
      plane: "lume",
      pool: "macos-private",
      available: 1,
      ts: 1_774_000_000_000
    });
  });

  test("defaults plane and pool fields so every log line has fleet labels", () => {
    const chunks: string[] = [];

    writeLog("info", "started", {}, {
      write: (chunk) => {
        chunks.push(chunk);
        return true;
      }
    });

    expect(JSON.parse(chunks[0])).toEqual(
      expect.objectContaining({
        level: "info",
        msg: "started",
        plane: "unknown",
        pool: "unknown"
      })
    );
  });
});
