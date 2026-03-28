import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, test } from "vitest";

describe("setup-shell-safe-node action", () => {
  test("downloads Node without restoring archive ownership", () => {
    const action = YAML.parse(
      fs.readFileSync(
        path.resolve("actions/setup-shell-safe-node/action.yml"),
        "utf8"
      )
    ) as {
      runs: { using: string; steps: Array<Record<string, unknown>> };
      inputs: Record<string, { default?: string }>;
    };

    expect(action.runs.using).toBe("composite");
    expect(action.inputs["node-version"]?.default).toBe("24.14.1");

    const installStep = action.runs.steps.find(
      (step) => step.name === "Install Node.js"
    );

    expect(installStep?.shell).toBe("bash");
    expect(String(installStep?.run)).toContain("https://nodejs.org/dist/");
    expect(String(installStep?.run)).toContain("--no-same-owner");
    expect(String(installStep?.run)).toContain('echo "${install_dir}/bin" >> "$GITHUB_PATH"');
    expect(String(installStep?.run)).toContain('runner_temp="${RUNNER_TEMP:-/tmp/github-runner-temp}"');
  });
});
