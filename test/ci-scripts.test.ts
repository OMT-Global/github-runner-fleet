import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

function readScript(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

const PLACEHOLDER_MARKERS = [
  "Generic archetype selected.",
  "No extended checks configured for the generic archetype yet.",
  "Add project-specific scripts and tighten"
];

describe("local CI gate scripts", () => {
  test("fast checks run lint, tests, and build", () => {
    const script = readScript("scripts/ci/run-fast-checks.sh");

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("pnpm install --frozen-lockfile");
    expect(script).toContain("pnpm lint");
    expect(script).toContain("pnpm test");
    expect(script).toContain("pnpm build");

    for (const marker of PLACEHOLDER_MARKERS) {
      expect(script).not.toContain(marker);
    }
  });

  test("extended validation runs fast checks plus the coverage gate", () => {
    const script = readScript("scripts/ci/run-extended-validation.sh");

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("bash scripts/ci/run-fast-checks.sh");
    expect(script).toContain("pnpm test:coverage");

    for (const marker of PLACEHOLDER_MARKERS) {
      expect(script).not.toContain(marker);
    }
  });

  test("extended validation documents that mutation testing stays a separate CI job", () => {
    const script = readScript("scripts/ci/run-extended-validation.sh");

    expect(script).toMatch(/mutation testing is intentionally not run here/i);
    expect(script).not.toContain("pnpm mutation-test");
  });

  test("the extended validation workflow keeps mutation testing as its own job", () => {
    const workflow = fs.readFileSync(
      path.resolve(".github/workflows/extended-validation.yml"),
      "utf8"
    );

    expect(workflow).toContain("pnpm mutation-test");
    expect(workflow).toContain("run-extended-validation.sh");
  });
});
