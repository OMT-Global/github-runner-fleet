import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, test } from "vitest";

const temporaryDirectories: string[] = [];
const imageRef = "ghcr.io/test/fleet:0.2.3";
const digest = `sha256:${"a".repeat(64)}`;
const sourceSha = "b".repeat(40);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-script-test-"));
  temporaryDirectories.push(directory);
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  const callsFile = path.join(directory, "calls.jsonl");
  const outputFile = path.join(directory, "outputs");
  const logDirectory = path.join(directory, "logs");
  fs.writeFileSync(outputFile, "");
  const stub = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({command, args}) + "\\n");
const env = process.env;
if (command === "docker") {
  if (args[0] === "run") {
    process.exit(args.includes(env.TEST_RUNTIME_FAIL_PLATFORM) ? 23 : 0);
  }
  const state = env.TEST_IMAGE_STATE || "missing";
  if (state === "present" || state === "invalid") {
    console.log(state === "present" ? env.TEST_DIGEST : "not-a-digest");
    process.exit(0);
  }
  console.error(state === "missing" ? "ERROR: " + args[3] + ": not found" : state);
  process.exit(1);
}
if (command === "gh") {
  if (args[0] === "attestation") {
    console.log(env.TEST_PROVENANCE_VALID === "true" ? "verified source provenance" : "source provenance mismatch");
    process.exit(env.TEST_PROVENANCE_VALID === "true" ? 0 : 1);
  }
  if (args.includes("--jq")) {
    console.log(env.TEST_TAG_IDENTITY || "commit " + env.GITHUB_SHA);
    process.exit(0);
  }
  if (args.includes("POST")) process.exit(env.TEST_TAG_CREATE_CONFLICT === "true" ? 1 : 0);
  if (args[0] === "release") process.exit(0);
  const state = args[2].includes("/releases/") ? env.TEST_RELEASE_STATE : env.TEST_TAG_STATE;
  if (state === "present") {
    console.log("HTTP/2.0 200 OK\\r\\n\\r\\n{}");
    process.exit(0);
  }
  if (state !== "network") console.log("HTTP/2.0 " + (state || "404") + " Not Found\\r\\n\\r\\n{}");
  console.error(state === "network" ? "error connecting to api.github.com" : "GitHub lookup failed");
  process.exit(1);
}
if (command === "cosign") {
  const countFile = env.TEST_ATTEMPTS;
  const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) + 1 : 1;
  fs.writeFileSync(countFile, String(count));
  if (count <= Number(env.TEST_SIGN_FAILURES || "0")) {
    console.error(env.TEST_SIGN_ERROR || 'Post "https://rekor.sigstore.dev/api/v1/log/entries" giving up after 2 attempt(s)');
    process.exit(2);
  }
  console.log("signed immutable image");
}
`;
  for (const name of ["docker", "gh", "cosign"]) {
    fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(bin, "timeout"), `#!/bin/bash
printf '%s\\n' "$1" >> "$TEST_TIMEOUTS"
if [[ "$TEST_TIMEOUT" == true ]]; then exit 124; fi
shift
exec "$@"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REPOSITORY: "test/fleet",
    GITHUB_SHA: sourceSha,
    GITHUB_RUN_ID: "1234",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_OUTPUT: outputFile,
    RELEASE_LOG_DIR: logDirectory,
    TEST_DIGEST: digest,
    TEST_CALLS: callsFile,
    TEST_ATTEMPTS: path.join(directory, "attempts"),
    TEST_TIMEOUTS: path.join(directory, "timeouts"),
    ...overrides
  };
  return {
    directory,
    logDirectory,
    run: (script: string, args: string[] = []) => spawnSync("bash", [path.resolve(script), ...args], {
      env, encoding: "utf8", timeout: 10_000
    }),
    runShell: (script: string) => spawnSync("bash", ["-c", script], {
      env, encoding: "utf8", timeout: 10_000
    }),
    output: () => fs.readFileSync(outputFile, "utf8"),
    calls: (): Array<{ command: string; args: string[] }> => fs.existsSync(callsFile)
      ? fs.readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      : []
  };
}

function preflight(context: ReturnType<typeof fixture>) {
  return context.run("scripts/release/preflight.sh", [imageRef, "v0.2.3"]);
}

describe("release preflight", () => {
  test("permits a new candidate only after confirmed registry and GitHub absence", () => {
    const context = fixture();
    expect(preflight(context).status).toBe(0);
    expect(context.output()).toContain("publish_required=true");
    expect(context.output()).toContain(`working_ref=ghcr.io/test/fleet:candidate-0.2.3-${sourceSha}-1234-1`);
    expect(context.calls().filter((call) => call.command === "gh").map((call) => call.args)).toEqual([
      ["api", "--include", "repos/test/fleet/releases/tags/v0.2.3"],
      ["api", "--include", "repos/test/fleet/git/ref/tags/v0.2.3"]
    ]);
  });

  test("uses distinct candidate references for retries and separate dispatches", () => {
    const contexts = [fixture(), fixture({ GITHUB_RUN_ATTEMPT: "2" }), fixture({ GITHUB_RUN_ID: "5678" })];
    const references = contexts.map((context) => {
      expect(preflight(context).status).toBe(0);
      return context.output().split("\n").find((line) => line.startsWith("working_ref="));
    });
    expect(new Set(references).size).toBe(3);
  });

  test.each([
    "ERROR: failed to do request: connection refused",
    "ERROR: unexpected status from HEAD request: 401 Unauthorized",
    "ERROR: no builder found: not found",
    `ERROR: ${imageRef}: not found\nERROR: registry unavailable`,
    "invalid"
  ])("fails closed on an uncertain registry result: %s", (state) => {
    const context = fixture({ TEST_IMAGE_STATE: state });
    expect(preflight(context).status).not.toBe(0);
    expect(context.output()).toBe("");
    expect(context.calls().every((call) => call.command === "docker")).toBe(true);
    expect(fs.existsSync(path.join(context.logDirectory, "final-image-inspect.log"))).toBe(true);
  });

  test.each(["403", "500", "network"])("fails closed on a GitHub release lookup failure: %s", (state) => {
    const context = fixture({ TEST_RELEASE_STATE: state });
    const result = preflight(context);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot establish github-release state");
    expect(context.output()).toBe("");
  });

  test("fails closed when source Git tag lookup fails", () => {
    const context = fixture({ TEST_TAG_STATE: "403" });
    expect(preflight(context).stderr).toContain("cannot establish github-tag state");
    expect(context.output()).toBe("");
  });

  test.each([
    { TEST_RELEASE_STATE: "present" },
    { TEST_TAG_STATE: "present" }
  ])("rejects existing release or source tag without its image: %j", (state) => {
    const context = fixture(state);
    const result = preflight(context);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("GitHub Release or Git tag exists");
    expect(context.output()).toBe("");
  });

  test.each([{}, { TEST_TAG_STATE: "present" }])("rejects orphan final-image recovery without verified source identity: %j", (state) => {
    const context = fixture({ TEST_IMAGE_STATE: "present", ...state });
    const result = preflight(context);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to attach this dispatch SHA to an older image");
    expect(context.output()).toBe("");
  });

  test.each(["404", "present"])("allows same-source image recovery with Git tag state %s", (tagState) => {
    const context = fixture({ TEST_IMAGE_STATE: "present", TEST_TAG_STATE: tagState, TEST_PROVENANCE_VALID: "true" });
    expect(preflight(context).status).toBe(0);
    expect(context.output()).toContain("publish_required=false");
    expect(context.output()).toContain("source_verified=true");
    expect(context.calls().find((call) => call.args[0] === "attestation")?.args).toEqual([
      "attestation", "verify", `oci://ghcr.io/test/fleet@${digest}`,
      "--repo", "test/fleet", "--signer-workflow", "test/fleet/.github/workflows/release-image.yml",
      "--source-ref", "refs/heads/main", "--source-digest", sourceSha
    ]);
    expect(fs.readFileSync(path.join(context.directory, "timeouts"), "utf8")).toBe("5m\n");
  });

  test.each([`commit ${"c".repeat(40)}`, `tag ${sourceSha}`])("rejects a recovery tag with identity %s", (identity) => {
    const context = fixture({ TEST_IMAGE_STATE: "present", TEST_TAG_STATE: "present", TEST_PROVENANCE_VALID: "true", TEST_TAG_IDENTITY: identity });
    expect(preflight(context).stderr).toContain("not a lightweight tag at the verified source SHA");
    expect(context.output()).toBe("");
  });

  test("fails closed when source provenance verification times out", () => {
    const context = fixture({ TEST_IMAGE_STATE: "present", TEST_TIMEOUT: "true" });
    expect(preflight(context).status).not.toBe(0);
    expect(context.output()).toBe("");
    expect(fs.readFileSync(path.join(context.directory, "timeouts"), "utf8")).toBe("5m\n");
  });

  test("rejects a GitHub Release whose source tag is missing", () => {
    const context = fixture({ TEST_IMAGE_STATE: "present", TEST_RELEASE_STATE: "present" });
    expect(preflight(context).stderr).toContain("GitHub Release has no matching Git tag");
    expect(context.output()).toBe("");
  });

  test("verifies an already completed release without rebuilding", () => {
    const context = fixture({ TEST_IMAGE_STATE: "present", TEST_RELEASE_STATE: "present", TEST_TAG_STATE: "present" });
    expect(preflight(context).status).toBe(0);
    expect(context.output()).toContain("publish_required=false");
    expect(context.output()).toContain(`final_digest=${digest}`);
    expect(context.output()).toContain(`working_ref=${imageRef}`);
    expect(context.calls().some((call) => call.args[0] === "attestation")).toBe(false);
  });

  test("stops promotion if a final image appeared after initial preflight", () => {
    const context = fixture({ TEST_IMAGE_STATE: "present", TEST_RELEASE_STATE: "present", TEST_TAG_STATE: "present", RELEASE_REQUIRE_ABSENT: "true" });
    expect(preflight(context).stderr).toContain("final image appeared after preflight");
    expect(context.output()).toBe("");
  });
});

describe("bounded signing retries", () => {
  test("recovers from transient Rekor failures and preserves every attempt", () => {
    const context = fixture({ TEST_SIGN_FAILURES: "2" });
    const result = context.run("scripts/release/retry.sh", ["sbom", "cosign", "attest", "--yes", `image@${digest}`]);
    expect(result.status).toBe(0);
    expect(context.calls()).toHaveLength(3);
    expect(fs.readFileSync(path.join(context.logDirectory, "sbom-attempt-1.log"), "utf8")).toContain("rekor.sigstore.dev");
    expect(fs.readFileSync(path.join(context.logDirectory, "sbom-attempt-3.log"), "utf8")).toContain("signed immutable image");
    expect(fs.readFileSync(path.join(context.directory, "timeouts"), "utf8")).toBe("2m\n2m\n2m\n");
  });

  test("returns persistent failure after three attempts", () => {
    const context = fixture({ TEST_SIGN_FAILURES: "10" });
    const result = context.run("scripts/release/retry.sh", ["sbom", "cosign", "attest"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("retry limit reached");
    expect(context.calls()).toHaveLength(3);
  });

  test("does not retry permanent signing failures", () => {
    const context = fixture({ TEST_SIGN_FAILURES: "10", TEST_SIGN_ERROR: "invalid predicate format" });
    expect(context.run("scripts/release/retry.sh", ["sbom", "cosign", "attest"]).status).toBe(2);
    expect(context.calls()).toHaveLength(1);
  });

  test("bounds hung attempts and returns the timeout status", () => {
    const context = fixture({ TEST_TIMEOUT: "true" });
    expect(context.run("scripts/release/retry.sh", ["sbom", "cosign", "attest"]).status).toBe(124);
    expect(fs.readdirSync(context.logDirectory)).toHaveLength(3);
    expect(fs.readFileSync(path.join(context.directory, "timeouts"), "utf8")).toBe("2m\n2m\n2m\n");
  });
});

describe("immutable runtime validation", () => {
  test("executes both platform checks against the same immutable digest", () => {
    const context = fixture();
    const subject = `ghcr.io/test/fleet:candidate-123@${digest}`;
    expect(context.run("scripts/release/validate-runtime.sh", [subject]).status).toBe(0);
    const calls = context.calls();
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.args[3])).toEqual(["linux/amd64", "linux/arm64"]);
    for (const call of calls) {
      expect(call.args[6]).toBe(subject);
      expect(call.args[8]).toContain("Runner.Listener --version");
      expect(call.args[8]).toContain("set -euo pipefail");
    }
  });

  test("refuses mutable tag validation", () => {
    const context = fixture();
    expect(context.run("scripts/release/validate-runtime.sh", [imageRef]).status).not.toBe(0);
    expect(context.calls()).toHaveLength(0);
  });

  test.each(["linux/amd64", "linux/arm64"])("propagates a runtime failure on %s", (platform) => {
    const context = fixture({ TEST_RUNTIME_FAIL_PLATFORM: platform });
    expect(context.run("scripts/release/validate-runtime.sh", [`image@${digest}`]).status).toBe(23);
    expect(context.calls()).toHaveLength(platform === "linux/amd64" ? 1 : 2);
  });
});

const workflow = YAML.parse(fs.readFileSync(path.resolve(".github/workflows/release-image.yml"), "utf8"));
const releaseStep = workflow.jobs.publish_and_verify.steps.find((step: { if?: string }) => step.if === "${{ inputs.publish_project_release }}");

function releaseScript(publishRequired: boolean, releaseExists: boolean, sourceVerified = false, tagExists = false): string {
  return (releaseStep.run as string)
    .replaceAll("${{ steps.release_state.outputs.publish_required }}", String(publishRequired))
    .replaceAll("${{ steps.release_state.outputs.release_exists }}", String(releaseExists))
    .replaceAll("${{ steps.release_state.outputs.source_verified }}", String(sourceVerified))
    .replaceAll("${{ steps.release_state.outputs.tag_exists }}", String(tagExists))
    .replaceAll("${{ steps.release_meta.outputs.release_tag }}", "v0.2.3");
}

describe("source-bound project release creation", () => {
  test("creates the source ref at the dispatch SHA before publishing its release", () => {
    const context = fixture();
    expect(context.runShell(releaseScript(true, false)).status).toBe(0);
    expect(context.calls().map((call) => call.args)).toEqual([
      ["api", "repos/test/fleet/git/refs", "--method", "POST", "-f", "ref=refs/tags/v0.2.3", "-f", `sha=${sourceSha}`],
      ["release", "create", "v0.2.3", "--verify-tag", "--title", "v0.2.3", "--generate-notes"]
    ]);
  });

  test("never reuses a source tag that appeared after preflight", () => {
    const context = fixture({ TEST_TAG_CREATE_CONFLICT: "true" });
    expect(context.runShell(releaseScript(true, false)).status).not.toBe(0);
    expect(context.calls()).toHaveLength(1);
  });

  test("does not recreate a completed GitHub Release", () => {
    const context = fixture();
    expect(context.runShell(releaseScript(false, true)).status).toBe(0);
    expect(context.calls()).toHaveLength(0);
  });

  test("does not create a release for an existing image at a new dispatch SHA", () => {
    const context = fixture();
    expect(context.runShell(releaseScript(false, false)).status).not.toBe(0);
    expect(context.calls()).toHaveLength(0);
  });

  test("creates missing release metadata after verifying same-source image provenance", () => {
    const context = fixture();
    expect(context.runShell(releaseScript(false, false, true)).status).toBe(0);
    expect(context.calls()).toHaveLength(2);
    expect(context.calls()[0]?.args).toContain(`sha=${sourceSha}`);
  });

  test("rechecks an existing same-source tag before finishing a partial release", () => {
    const context = fixture();
    expect(context.runShell(releaseScript(false, false, true, true)).status).toBe(0);
    expect(context.calls()).toHaveLength(2);
    expect(context.calls()[0]?.args).toContain("repos/test/fleet/git/ref/tags/v0.2.3");
    expect(context.calls()[1]?.args.slice(0, 2)).toEqual(["release", "create"]);
  });

  test("refuses recovery if an existing tag moved after source verification", () => {
    const context = fixture({ TEST_TAG_IDENTITY: `commit ${"c".repeat(40)}` });
    expect(context.runShell(releaseScript(false, false, true, true)).status).not.toBe(0);
    expect(context.calls()).toHaveLength(1);
  });

  test.each(["refs/heads/other", "refs/tags/main"])("rejects a release dispatch from %s", (ref) => {
    const context = fixture({ GITHUB_REF: ref });
    const guard = workflow.jobs.publish_and_verify.steps.find((step: { name?: string }) => step.name === "guard main branch before any publish");
    expect(context.runShell(guard.run).status).not.toBe(0);
  });
});
