import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("config-diff package script", () => {
  test("exposes the operator-facing config-diff command", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["config-diff"]).toBe(
      "tsx src/cli.ts config-diff"
    );
  });
});
