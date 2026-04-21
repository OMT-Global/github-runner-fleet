import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("mutation testing", () => {
  test("exposes the Stryker command through package scripts", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["mutation-test"]).toBe("stryker run");
  });

  test("targets high-value library modules with a build-breaking threshold", async () => {
    const strykerConfig = (await import(
      path.resolve("stryker.config.mjs")
    )) as {
      default: {
        testRunner: string;
        plugins: string[];
        reporters: string[];
        coverageAnalysis: string;
        mutate: string[];
        thresholds: Record<string, number>;
      };
    };

    expect(strykerConfig.default).toMatchObject({
      testRunner: "vitest",
      plugins: ["@stryker-mutator/vitest-runner"],
      reporters: ["html", "clear-text", "progress"],
      coverageAnalysis: "perTest",
      thresholds: {
        high: 80,
        low: 60,
        break: 50
      }
    });
    expect(strykerConfig.default.mutate).toEqual([
      "src/lib/config.ts",
      "src/lib/github.ts",
      "src/lib/doctor.ts",
      "src/lib/env.ts"
    ]);
  });
});
