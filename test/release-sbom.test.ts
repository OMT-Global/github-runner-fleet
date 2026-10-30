import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { afterEach, describe, expect, test } from "vitest";

const workflow = YAML.parse(fs.readFileSync(".github/workflows/release-image.yml", "utf8"));
const steps = workflow.jobs.publish_and_verify.steps as Array<{
  name?: string; run?: string; uses?: string; with?: Record<string, string>;
}>;
const prepare = steps.find((step) => step.name === "Resolve SBOM signing config from verified TUF metadata")!.run!;
const dirs: string[] = [];
const v1 = { url: "https://legacy.example.invalid", majorApiVersion: 1 };
const v2 = { url: "https://tiles.example.invalid", majorApiVersion: 2 };
function fixture() {
  return {
    mediaType: "application/vnd.dev.sigstore.signingconfig.v0.2+json",
    rekorTlogUrls: [v1, v2], rekorTlogConfig: { selector: "ANY" },
    caUrls: [{ url: "https://ca.example.invalid", majorApiVersion: 1 }],
    oidcUrls: [{ url: "https://identity.example.invalid", majorApiVersion: 1 }],
    tsaUrls: [{ url: "https://time.example.invalid", majorApiVersion: 1 }],
    tsaConfig: { selector: "ANY" }
  };
}
function run(config: unknown, failure = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-sbom-config-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "fixture.json"), JSON.stringify(config));
  fs.writeFileSync(path.join(dir, "cosign"), `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
if (process.env.TUF_TEST_FAILURE === "1") process.exit(42);
if (a[0] !== "signing-config" || a[1] !== "create" || !a.includes("--with-default-rekor-v2")) process.exit(43);
fs.copyFileSync(process.env.CONFIG_FIXTURE, a[a.indexOf("--out") + 1]);
`, { mode: 0o755 });
  const result = spawnSync("bash", ["-c", prepare], {
    encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
      RELEASE_LOG_DIR: dir, CONFIG_FIXTURE: path.join(dir, "fixture.json"), TUF_TEST_FAILURE: failure ? "1" : "0" }
  });
  const file = path.join(dir, "sbom-signing-config.json");
  return { result, config: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("large-SBOM signing boundary", () => {
  test("uses the supported client and preserves complete signed/timestamped SPDX verification", () => {
    expect(steps.find((step) => step.uses === "sigstore/cosign-installer@v4.1.2")!.with!["cosign-release"]).toBe("v3.1.4");
    const attest = steps.find((step) => step.name === "Attach SBOM attestation")!.run!;
    expect(attest).toContain('--signing-config "$RELEASE_LOG_DIR/sbom-signing-config.json"');
    expect(attest).toContain("--predicate /tmp/github-runner-fleet.spdx.json");
    const verify = steps.find((step) => step.name === "Verify image signature and attestations")!.run!;
    expect(verify).toContain("--type spdxjson --use-signed-timestamps");
    expect(verify).toContain("--type slsaprovenance1");
    expect(verify).not.toMatch(/insecure-ignore|tlog-upload=false|ignore-tlog/);
  });
  test("excludes legacy fallback while retaining TUF-selected CA, identity, timestamp and selector data", () => {
    const input = fixture(); const output = run(input);
    expect(output.result.status).toBe(0);
    expect(output.config).toEqual({ ...input, rekorTlogUrls: [v2] });
  });
  test("refuses an authenticated configuration with only legacy logs", () => {
    const input = fixture(); input.rekorTlogUrls = [v1];
    expect(run(input).result.status).not.toBe(0);
  });
  test("refuses missing log service", () => {
    const input = fixture(); input.rekorTlogUrls = [];
    expect(run(input).result.status).not.toBe(0);
  });
  test("refuses missing timestamp authority", () => {
    const input = fixture(); input.tsaUrls = [];
    expect(run(input).result.status).not.toBe(0);
  });
  test("refuses insecure log transport", () => {
    const input = fixture(); input.rekorTlogUrls = [{ ...v2, url: "http://tiles.example.invalid" }];
    expect(run(input).result.status).not.toBe(0);
  });
  test("refuses insecure timestamp transport", () => {
    const input = fixture(); input.tsaUrls[0].url = "http://time.example.invalid";
    expect(run(input).result.status).not.toBe(0);
  });
  test("propagates TUF resolution failure without manufacturing a usable config", () => {
    const output = run(fixture(), true);
    expect(output.result.status).toBe(42);
    expect(output.config).toBeUndefined();
  });
});
