import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("workflow cookbook docs", () => {
  test("publishes the compatibility matrix and key workflow recipes", () => {
    const cookbook = read("docs/workflow-cookbook.md");
    const readme = read("README.md");

    expect(readme).toContain("docs/workflow-cookbook.md");

    expect(cookbook).toContain("## Runner compatibility matrix");
    expect(cookbook).toContain("| Node install, lint, test, build | Yes |");
    expect(cookbook).toContain("| Public fork pull requests | No | No | Yes |");

    expect(cookbook).toContain("## Recipe: trusted Node job on the Synology shell-only pool");
    expect(cookbook).toContain("## Recipe: trusted jobs on self-hosted, fork PRs on GitHub-hosted");
    expect(cookbook).toContain("## Recipe: Python 3.12 on the Synology shell-only pool");
    expect(cookbook).toContain("## Recipe: Terraform validation on the Synology shell-only pool");
    expect(cookbook).toContain("## Recipe: Lume macOS contract job");

    expect(cookbook).toContain("OMT-Global/synology-github-runner/actions/setup-shell-safe-node@main");
    expect(cookbook).toContain("actions/setup-python@v6");
    expect(cookbook).toContain("github.event.pull_request.head.repo.full_name != github.repository");
    expect(cookbook).toContain("runs-on: ubuntu-latest");
    expect(cookbook).toContain("runs-on:");
    expect(cookbook).toContain("- self-hosted");
    expect(cookbook).toContain("- synology");
    expect(cookbook).toContain("- shell-only");
    expect(cookbook).toContain("- public");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}
