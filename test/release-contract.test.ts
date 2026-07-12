import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

describe("release contract", () => {
  test("keeps the package version aligned with the configured image tag", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8")
    ) as { version: string };
    const config = YAML.parse(
      fs.readFileSync(path.resolve("config/pools.yaml"), "utf8")
    ) as {
      image: {
        tag: string;
      };
    };

    expect(packageJson.version).toBe(config.image.tag);
  });

  test("documents verification-only recovery without replacing an existing tag", () => {
    const recovery = fs.readFileSync(
      path.resolve("docs/release-recovery.md"),
      "utf8"
    );

    expect(recovery).toContain("verification-only recovery mode");
    expect(recovery).toContain("does not rebuild, replace, re-sign, or re-attest");
    expect(recovery).toContain("supersede the candidate with a new version");
    expect(recovery).toContain("bounded to five minutes");
  });
});
