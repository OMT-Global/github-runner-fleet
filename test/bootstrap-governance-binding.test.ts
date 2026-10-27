import fs from "node:fs";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

type Step = { name?: string; env?: Record<string, string>; run?: string };
type Workflow = { env?: Record<string, string>; jobs: Record<string, { steps: Step[] }> };
const readWorkflow = () => fs.readFileSync(".github/workflows/extended-validation.yml", "utf8");
const expression = (body: string) => "$" + "{{ " + body + " }}";

function step(job: string, name: string): Step {
  const workflow = YAML.parse(readWorkflow()) as Workflow;
  const matches = workflow.jobs[job].steps.filter((entry) => entry.name === name);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("separate Bootstrap governance credential binding", () => {
  test("uses only the governance-read credential with the existing GitHub token fallback", () => {
    const check = step("bootstrap-drift", "Require an empty managed-file plan");
    expect(check.env).toEqual({
      BOOTSTRAP_CLI: expression("github.workspace") + "/.bootstrap-control-plane/dist/cli.js",
      GH_TOKEN: expression("secrets.RUNNER_FLEET_GOVERNANCE_READ_PAT || github.token"),
      VERIFY_GITHUB_GOVERNANCE: expression("github.event_name != 'pull_request'")
    });
    expect(check.run).toBe("bash scripts/ci/check-bootstrap-drift.sh");
  });

  test("retains the existing organization drift credential without a governance credential fallback", () => {
    const drift = step("drift-detect", "Compare desired and actual runner pool state");
    expect(drift.env).toEqual({
      GITHUB_PAT: expression("secrets.RUNNER_FLEET_GITHUB_PAT"),
      DRIFT_THRESHOLD: expression("vars.DRIFT_THRESHOLD"),
      DRIFT_NOTIFY_CHANNEL: expression("vars.DRIFT_NOTIFY_CHANNEL")
    });
  });

  test("does not widen either secret binding to other workflow consumers", () => {
    const workflow = readWorkflow();
    expect(workflow.split("secrets.RUNNER_FLEET_GOVERNANCE_READ_PAT")).toHaveLength(2);
    expect(workflow.split("secrets.RUNNER_FLEET_GITHUB_PAT")).toHaveLength(2);
    const globalEnv = (YAML.parse(workflow) as Workflow).env ?? {};
    expect(Object.keys(globalEnv).sort()).toEqual(["NODE_VERSION", "PYTHON_VERSION"]);
  });

  test("retains the checker's two fail-fast reads and explicit governance opt-in", () => {
    const checker = fs.readFileSync("scripts/ci/check-bootstrap-drift.sh", "utf8");
    const shell = (body: string) => "$" + "{" + body + "}";
    expect(checker.split(String.fromCharCode(10)).filter((line) => line.startsWith("gh api "))).toEqual([
      'gh api "repos/' + shell("GITHUB_REPOSITORY") + '" > "' + shell("repo_file") + '"',
      'gh api "repos/' + shell("GITHUB_REPOSITORY") + '/branches/' + shell("default_branch") + '/protection" > "' + shell("protection_file") + '"'
    ]);
    expect(checker).toContain("set -Eeuo pipefail");
    expect(checker).toContain('if [[ "' + shell("VERIFY_GITHUB_GOVERNANCE:-false") + '" != "true" ]]; then');
    expect(checker).toContain('change.type !== "unchanged"');
    expect(checker).toContain("bootstrap GitHub governance drift detected");
  });
});
