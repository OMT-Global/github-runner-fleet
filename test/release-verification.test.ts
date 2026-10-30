import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, test } from "vitest";

const workflow = YAML.parse(fs.readFileSync(".github/workflows/release-image.yml", "utf8"));
const steps = workflow.jobs.publish_and_verify.steps as Array<{
  name?: string; run?: string; if?: string; "timeout-minutes"?: number;
}>;
const verify = steps.find((step) => step.name === "Verify image signature and attestations")!;
const repository = "OMT-Global/github-runner-fleet";
const digest = `sha256:${"0".repeat(64)}`;
const sha = "a".repeat(40);
const dirs: string[] = [];
type Stage = "signature" | "sbom" | "provenance";

function run(options: { fail?: Stage; timeoutExit?: 124 | 137; badSource?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-verify-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "timeout"), `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const a = process.argv.slice(2);
const offset = a[0].startsWith("--kill-after=") ? 2 : 1;
const command = a[offset]; const args = a.slice(offset + 1);
const stage = args[0] === "verify" ? "signature" : args.includes("spdxjson") ? "sbom" : "provenance";
fs.appendFileSync(process.env.RECORD, JSON.stringify({ stage, timeout: a.slice(0, offset), command, args }) + "\\n");
if (stage === "sbom" && process.env.TIMEOUT_EXIT) {
  process.stdout.write("partial attestation"); process.stderr.write("fixture timeout\\n");
  process.exit(Number(process.env.TIMEOUT_EXIT));
}
const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "cosign"), `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
const stage = a[0] === "verify" ? "signature" : a.includes("spdxjson") ? "sbom" : "provenance";
const identity = "https://github.com/" + process.env.GITHUB_REPOSITORY + "/.github/workflows/release-image.yml@refs/heads/main";
if (a[a.indexOf("--certificate-identity-regexp") + 1] !== identity ||
    a[a.indexOf("--certificate-oidc-issuer") + 1] !== "https://token.actions.githubusercontent.com" ||
    a.at(-1) !== "ghcr.io/omt-global/github-runner-fleet@" + process.env.EXPECTED_DIGEST ||
    (stage === "sbom" && !a.includes("--use-signed-timestamps"))) process.exit(99);
process.stderr.write(stage + " diagnostics\\n");
if (process.env.FAIL_STAGE === stage) { process.stdout.write("partial " + stage); process.exit(42); }
if (stage === "sbom") {
  const chunk = Buffer.alloc(1024 * 1024, "x");
  for (let n = 0; n < 26; n++) fs.writeSync(1, chunk);
} else if (stage === "provenance") {
  const statement = { predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ digest: { sha256: process.env.EXPECTED_DIGEST.slice(7) } }],
    predicate: { buildDefinition: { buildType: "https://actions.github.io/buildtypes/workflow/v1",
      resolvedDependencies: [{ uri: "git+https://github.com/" + process.env.GITHUB_REPOSITORY + "@refs/heads/main",
        digest: { gitCommit: process.env.BAD_SOURCE ? "b".repeat(40) : process.env.GITHUB_SHA } }] } } };
  process.stdout.write(JSON.stringify([{ payload: Buffer.from(JSON.stringify(statement)).toString("base64") }]));
} else process.stdout.write("[]");
`, { mode: 0o755 });
  const script = verify.run!
    .replaceAll("${{ steps.release_meta.outputs.image_repo }}", "ghcr.io/omt-global/github-runner-fleet")
    .replaceAll("${{ steps.image_digest.outputs.digest }}", digest)
    .replaceAll("${{ github.repository }}", repository);
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf8", maxBuffer: 64 * 1024, timeout: 10_000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RELEASE_LOG_DIR: dir,
      GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, EXPECTED_DIGEST: digest,
      RECORD: path.join(dir, "commands.jsonl"), FAIL_STAGE: options.fail ?? "",
      TIMEOUT_EXIT: options.timeoutExit ? String(options.timeoutExit) : "", BAD_SOURCE: options.badSource ? "1" : "" }
  });
  const record = path.join(dir, "commands.jsonl");
  const commands = fs.existsSync(record)
    ? fs.readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    : [];
  return { dir, result, commands };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("release verification execution", () => {
  test("preserves complete 26 MiB SBOM output while keeping the console bounded", () => {
    const { dir, result, commands } = run();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThan(2048);
    expect(result.stdout).toContain("Verified signature, complete SBOM and reviewed-source provenance.");
    const sbom = fs.readFileSync(path.join(dir, "verified-sbom.json"));
    expect(sbom.length).toBe(26 * 1024 * 1024);
    const expected = createHash("sha256");
    for (let n = 0; n < 26; n++) expected.update(Buffer.alloc(1024 * 1024, "x"));
    expect(createHash("sha256").update(sbom).digest("hex")).toBe(expected.digest("hex"));
    expect(fs.readFileSync(path.join(dir, "sbom-stderr.log"), "utf8")).toBe("sbom diagnostics\n");
    expect(commands.map((command) => command.stage)).toEqual(["signature", "sbom", "provenance"]);
    expect(commands.every((command) => command.command === "cosign" &&
      JSON.stringify(command.timeout) === JSON.stringify(["--kill-after=10s", "5m"]))).toBe(true);
  });

  test.each<Stage>(["signature", "sbom", "provenance"])("propagates %s rejection and stops later verification", (stage) => {
    const { dir, result, commands } = run({ fail: stage });
    expect(result.status).toBe(42);
    const sequence = ["signature", "sbom", "provenance"];
    expect(commands.map((command) => command.stage)).toEqual(sequence.slice(0, sequence.indexOf(stage) + 1));
    expect(fs.readFileSync(path.join(dir, `verified-${stage}.json`), "utf8")).toBe(`partial ${stage}`);
    expect(result.stderr).toContain(`Verification ${stage} failed (exit 42)`);
    expect(result.stdout).not.toContain("reviewed-source provenance.");
  });

  test.each([124, 137] as const)("preserves timeout exit %s, partial diagnostics and the failure boundary", (status) => {
    const { dir, result, commands } = run({ timeoutExit: status });
    expect(result.status).toBe(status);
    expect(commands.map((command) => command.stage)).toEqual(["signature", "sbom"]);
    expect(fs.readFileSync(path.join(dir, "verified-sbom.json"), "utf8")).toBe("partial attestation");
    expect(fs.readFileSync(path.join(dir, "sbom-stderr.log"), "utf8")).toBe("fixture timeout\n");
    expect(fs.existsSync(path.join(dir, "verified-provenance.json"))).toBe(false);
  });

  test("rejects verified provenance for a different source commit", () => {
    const { result } = run({ badSource: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("verified provenance does not bind this image to the reviewed source");
    expect(result.stdout).not.toContain("Verified signature, complete SBOM and reviewed-source provenance.");
  });

  test("bounds verification and diagnostic upload, including failure or cancellation", () => {
    expect(verify["timeout-minutes"]).toBe(17);
    const diagnostics = steps.find((step) => step.name === "Preserve verification diagnostics")!;
    expect(diagnostics.if).toBe("${{ always() }}");
    expect(diagnostics["timeout-minutes"]).toBe(3);
  });
});
