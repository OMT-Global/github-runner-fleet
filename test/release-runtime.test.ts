import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, test } from "vitest";

const workflow = YAML.parse(fs.readFileSync(".github/workflows/release-image.yml", "utf8"));
const steps = workflow.jobs.publish_and_verify.steps as Array<{ name?: string; run?: string }>;
const probes = steps.filter((step) => step.run?.includes("Runner.Listener --version") ||
  step.name === "Clear local digest reference between platform probes");
const repository = "ghcr.io/omt-global/github-runner-fleet";
const digest = `sha256:${"a".repeat(64)}`;
const subject = `${repository}@${digest}`;
const unrelated = "example.invalid/unrelated:keep";
const dirs: string[] = [];

function run(options: { omitRemoval?: boolean; fail?: "linux/amd64" | "remove" | "linux/arm64" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-runtime-"));
  dirs.push(dir);
  const statePath = path.join(dir, "references.json");
  const recordPath = path.join(dir, "commands.jsonl");
  fs.writeFileSync(statePath, JSON.stringify({ [unrelated]: "unrelated-image-id" }));
  fs.writeFileSync(path.join(dir, "timeout"), `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const a = process.argv.slice(2);
if (a[0] !== "5m") process.exit(99);
const result = spawnSync(a[1], a.slice(2), { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  // Model the classic store's immutable reference -> one platform image ID mapping.
  fs.writeFileSync(path.join(dir, "docker"), `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.RECORD, JSON.stringify(a) + "\\n");
const refs = JSON.parse(fs.readFileSync(process.env.REFERENCES, "utf8"));
const subject = process.env.SUBJECT;
if (a[0] === "run") {
  const platform = a[a.indexOf("--platform") + 1];
  if (!a.includes(subject) || !a.includes("--rm") ||
      !["linux/amd64", "linux/arm64"].includes(platform)) process.exit(99);
  if (process.env.FAIL === platform) process.exit(42);
  if (refs[subject] && refs[subject] !== platform) {
    process.stderr.write("cannot overwrite digest " + subject.split("@")[1] + "\\n");
    process.exit(125);
  }
  refs[subject] = platform;
} else if (JSON.stringify(a) === JSON.stringify(["image", "rm", subject])) {
  if (process.env.FAIL === "remove") process.exit(42);
  if (!refs[subject]) process.exit(1);
  delete refs[subject];
} else process.exit(99);
fs.writeFileSync(process.env.REFERENCES, JSON.stringify(refs));
`, { mode: 0o755 });
  let status: number | null = 0;
  let stderr = "";
  let promotionReached = false;
  for (const step of probes) {
    if (options.omitRemoval && step.name === "Clear local digest reference between platform probes") continue;
    const script = step.run!
      .replaceAll("${{ steps.release_meta.outputs.image_repo }}", repository)
      .replaceAll("${{ steps.image_digest.outputs.digest }}", digest);
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUBJECT: subject,
        RECORD: recordPath, REFERENCES: statePath, FAIL: options.fail ?? "" }
    });
    expect(result.error).toBeUndefined();
    stderr += result.stderr;
    status = result.status;
    if (status !== 0) break;
  }
  if (status === 0) promotionReached = true;
  const commands = fs.readFileSync(recordPath, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as string[]);
  return { status, stderr, promotionReached, commands,
    references: JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, string> };
}

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("release platform runtime execution", () => {
  test("reproduces the hosted digest collision without local reference removal", () => {
    const result = run({ omitRemoval: true });
    expect(result.status).toBe(125);
    expect(result.stderr).toContain(`cannot overwrite digest ${digest}`);
    expect(result.promotionReached).toBe(false);
    expect(result.commands).toHaveLength(2);
    expect(result.references[subject]).toBe("linux/amd64");
  });

  test("runs both platforms by the same verified index and removes only its local reference", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.promotionReached).toBe(true);
    expect(result.commands).toHaveLength(3);
    expect(result.commands[0]).toContain("linux/amd64");
    expect(result.commands[1]).toEqual(["image", "rm", subject]);
    expect(result.commands[2]).toContain("linux/arm64");
    expect(result.references).toEqual({ [unrelated]: "unrelated-image-id", [subject]: "linux/arm64" });
  });

  test.each([
    ["linux/amd64", 1], ["remove", 2], ["linux/arm64", 3]
  ] as const)("stops before promotion when %s fails", (fail, count) => {
    const result = run({ fail });
    expect(result.status).toBe(42);
    expect(result.promotionReached).toBe(false);
    expect(result.commands).toHaveLength(count);
  });
});
