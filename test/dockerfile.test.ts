import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("Dockerfile packaging", () => {
  test("installs procps when the healthcheck uses pgrep", () => {
    const dockerfile = fs.readFileSync(
      path.resolve("docker/Dockerfile"),
      "utf8"
    );

    expect(dockerfile).toContain('CMD pgrep -f "Runner.Listener" > /dev/null || exit 1');
    expect(dockerfile).toMatch(/\bprocps\b/);
  });
});
