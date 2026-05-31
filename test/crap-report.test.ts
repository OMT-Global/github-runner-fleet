import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("CRAP reporting", () => {
  test("defines a report:crap script and emits json coverage", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(packageJson.scripts["report:crap"]).toBe("npm run test:coverage && node scripts/report-crap.mjs");
  });

  test("configures vitest coverage json reporter and ships the report script", () => {
    const vitestConfig = fs.readFileSync(path.resolve("vitest.config.ts"), "utf8");
    expect(vitestConfig).toContain('reporter: ["text", "lcov", "html", "json"]');
    expect(fs.existsSync(path.resolve("scripts/report-crap.mjs"))).toBe(true);
  });
});
