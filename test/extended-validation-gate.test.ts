import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

const workflow = YAML.parse(fs.readFileSync(".github/workflows/extended-validation.yml", "utf8"));
const gate = workflow.jobs["extended-validation-gate"];
const step = gate.steps.find((entry: { name: string }) => entry.name === "Check extended validation jobs");
const jobs = ["bootstrap-drift", "changes", "fast-checks", "extended-checks", "drift-detect", "mutation-tests", "validate-secrets"];
const success = Object.fromEntries(jobs.map((job) => [job, "success"]));
function fullSuiteScope() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-classifier-"));
  try {
    const output = path.join(root, "output");
    const preset = workflow.jobs.changes.steps.find((entry: { id?: string }) => entry.id === "preset");
    const run = spawnSync("bash", ["-e", "-o", "pipefail", "-c", String(preset.run)], {
      encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin", GITHUB_OUTPUT: output }
    });
    if (run.status !== 0) throw Error("actual full-suite preset failed: " + run.stderr);
    const flags = Object.fromEntries(fs.readFileSync(output, "utf8").trim().split("\n").map((line) => line.split("=")));
    return { EVENT_NAME: "schedule", BEHAVIOR_CHANGED: flags.behavior, UNKNOWN_CHANGED: flags.unknown, EXTENDED_CHANGED: flags.extended };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const scope = fullSuiteScope();
const toolPath = path.dirname(process.execPath) + ":/usr/bin:/bin";

function results(statuses: Record<string, string | undefined>) {
  return String(step.env.RESULTS).replace(/\$\{\{ needs\.([\w-]+)\.result \}\}/g,
    (_match: string, job: string) => statuses[job] ?? "");
}

function runGate(statuses = success, overrides: Record<string, string> = {}) {
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", String(step.run)], {
    encoding: "utf8", timeout: 5000,
    env: { PATH: toolPath, LANG: "C.UTF-8", ...scope, RESULTS: results(statuses), ...overrides }
  });
}

function expectFailure(run: ReturnType<typeof runGate>) {
  expect(run.error).toBeUndefined();
  expect(run.status).toBe(1);
  expect(run.stdout + run.stderr).toContain("FAIL");
}

function pushScope(behavior: string, unknown: string, extended: string) {
  const statuses: Record<string, string> = { ...success, "drift-detect": "skipped" };
  if (behavior !== "true" && unknown !== "true") statuses["fast-checks"] = "skipped";
  if (behavior !== "true" && unknown !== "true" && extended !== "true") {
    statuses["extended-checks"] = "skipped";
    statuses["mutation-tests"] = "skipped";
  }
  return { statuses, env: { EVENT_NAME: "push", BEHAVIOR_CHANGED: behavior, UNKNOWN_CHANGED: unknown, EXTENDED_CHANGED: extended } };
}

describe("extended validation fail-closed gate", () => {
  test("binds every named dependency and scope input to the real gate", () => {
    expect(gate.needs).toEqual(jobs);
    expect(gate.if).toBe("$" + "{{ always() && github.event_name != 'pull_request' }}");
    for (const job of jobs) expect(step.env.RESULTS).toContain("needs." + job + ".result");
    expect(step.env.EVENT_NAME).toBe("$" + "{{ github.event_name }}");
    for (const [name, output] of [["BEHAVIOR_CHANGED", "behavior"], ["UNKNOWN_CHANGED", "unknown"], ["EXTENDED_CHANGED", "extended"]]) {
      expect(step.env[name]).toBe("$" + "{{ needs.changes.outputs." + output + " }}");
    }
    expect(workflow.jobs["bootstrap-drift"].if).toBeUndefined();
    expect(workflow.jobs.changes.if).toBe("github.event_name != 'pull_request'");
    expect(workflow.jobs["validate-secrets"].if).toBe("github.event_name != 'pull_request'");
    for (const job of ["fast-checks", "extended-checks", "mutation-tests"]) {
      expect(workflow.jobs[job].if).toContain("needs.changes.outputs.behavior == 'true'");
      expect(workflow.jobs[job].if).toContain("needs.changes.outputs.unknown == 'true'");
    }
    expect(workflow.jobs["drift-detect"].if).toBe("github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'");
  });

  test.each(["schedule", "workflow_dispatch"])("accepts all required successes on %s", (event) => {
    expect(runGate(success, { EVENT_NAME: event }).status).toBe(0);
  });

  test.each(["schedule", "workflow_dispatch"])("accepts a conservative unknown=true full-suite result on %s", (event) => {
    expect(runGate(success, { EVENT_NAME: event, UNKNOWN_CHANGED: "true" }).status).toBe(0);
  });

  for (const behavior of ["true", "false"]) for (const unknown of ["true", "false"]) for (const extended of ["true", "false"]) {
    test("accepts only conditionally justified push skips: " + [behavior, unknown, extended].join("/"), () => {
      const fixture = pushScope(behavior, unknown, extended);
      expect(runGate(fixture.statuses, fixture.env).status).toBe(0);
    });
  }

  for (const job of jobs) {
    test.each(["failure", "cancelled", "skipped", "", "unknown"])("rejects required " + job + " => %s", (status) => {
      expectFailure(runGate({ ...success, [job]: status }));
    });
    test("rejects an omitted required result: " + job, () => {
      const input = results(success).split(/\s+/).filter((entry) => !entry.startsWith(job + "=")).join(" ");
      expectFailure(runGate(success, { RESULTS: input }));
    });
  }

  test("propagates the real checker failure after an empty plan and a fixture governance403", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-governance403-"));
    try {
      fs.mkdirSync(path.join(root, "dist"));
      fs.mkdirSync(path.join(root, "node_modules"));
      fs.symlinkSync(fs.realpathSync("node_modules/yaml"), path.join(root, "node_modules/yaml"));
      fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
      fs.writeFileSync(path.join(root, "dist/cli.js"), 'throw Error("aggregate planner must not run");');
      fs.writeFileSync(path.join(root, "dist/manifest.js"), 'export async function loadManifest() { return {}; }');
      fs.writeFileSync(path.join(root, "dist/render.js"), 'export async function planRepo() { return {changes: []}; }');
      fs.writeFileSync(path.join(root, "gh"), '#!/bin/sh\necho "gh: Resource not accessible by personal access token (HTTP 403)" >&2\nexit 1\n', { mode: 0o755 });
      const check = spawnSync("bash", ["scripts/ci/check-bootstrap-drift.sh"], {
        encoding: "utf8", timeout: 5000,
        env: { PATH: root + ":" + toolPath, TMPDIR: root, BOOTSTRAP_CLI: path.join(root, "dist/cli.js"),
          GITHUB_REPOSITORY: "OMT-Global/github-runner-fleet", GH_TOKEN: "synthetic-not-a-credential", VERIFY_GITHUB_GOVERNANCE: "true" }
      });
      expect(check.status).toBe(1);
      expect(check.stdout).toContain("bootstrap managed-file plan is empty");
      expect(check.stderr).toContain("HTTP 403");
      const aggregate = runGate({ ...success, "bootstrap-drift": "failure" });
      expectFailure(aggregate);
      expect(aggregate.stdout).toContain("FAIL bootstrap-drift => failure");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test.each(["", "bootstrap-drift=success", "invalid", "unexpected=success"])("rejects empty or incomplete input: %s", (input) => {
    expectFailure(runGate(success, { RESULTS: input }));
  });
  test.each(["changes=success", "unexpected=success", "malformed", "changes=success=success"])("rejects appended duplicate, unknown or malformed entries: %s", (entry) => {
    expectFailure(runGate(success, { RESULTS: results(success) + " " + entry }));
  });
  test.each(["BEHAVIOR_CHANGED", "UNKNOWN_CHANGED", "EXTENDED_CHANGED"])("rejects missing or invalid classification: %s", (key) => {
    for (const value of ["", "unknown"]) expectFailure(runGate(success, { [key]: value }));
  });
  test.each(["", "pull_request", "unexpected"])("rejects unsupported or missing event: %s", (event) => {
    expectFailure(runGate(success, { EVENT_NAME: event }));
  });
  test("rejects false full-suite classification on scheduled/manual runs", () => {
    const fixture = pushScope("false", "false", "false");
    for (const event of ["schedule", "workflow_dispatch"]) {
      expectFailure(runGate(fixture.statuses, { ...fixture.env, EVENT_NAME: event }));
    }
  });
  test("does not ignore failing or missing optional jobs on docs-only pushes", () => {
    const fixture = pushScope("false", "false", "false");
    for (const job of ["fast-checks", "extended-checks", "mutation-tests", "drift-detect"]) {
      for (const status of ["failure", "cancelled", ""]) {
        expectFailure(runGate({ ...fixture.statuses, [job]: status }, fixture.env));
      }
    }
  });
});
