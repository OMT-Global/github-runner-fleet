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
    const linuxConfig = YAML.parse(
      fs.readFileSync(path.resolve("config/linux-docker-runners.yaml"), "utf8")
    ) as { image: { tag: string } };

    expect(packageJson.version).toBe(config.image.tag);
    expect(linuxConfig.image.tag).toBe(config.image.tag);
    expect(fs.existsSync(path.resolve("docker-compose.yml"))).toBe(false);
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
    expect(recovery).toContain("Version `0.2.2` supersedes it");
  });

  test("keeps the unreleased Windows plane explicitly experimental", () => {
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const windowsConfig = fs.readFileSync(
      path.resolve("config/windows-runners.yaml"),
      "utf8"
    );

    expect(readme).toContain("Windows Docker Template (Experimental)");
    expect(readme).toContain(
      "does not currently build, publish, sign, or smoke-test a Windows image"
    );
    expect(windowsConfig).toContain("Experimental template only");
  });
});
