import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("runner registration smoke harness", () => {
  test("exercises registration and cleanup token flow in both execution modes", () => {
    const script = fs.readFileSync(
      path.resolve("scripts/smoke-test.sh"),
      "utf8"
    );

    expect(script).toContain("run_smoke_case runner");
    expect(script).toContain("run_smoke_case root");
    expect(script).toContain(
      "POST /orgs/test-org/actions/runners/registration-token"
    );
    expect(script).toContain("POST /orgs/test-org/actions/runners/remove-token");
    expect(script).toContain("--token registration-token");
    expect(script).toContain("remove --token remove-token");
    expect(script).toContain(
      "--runnergroup synology-private --ephemeral --disableupdate"
    );
  });

  test("uses stubbed runner scripts instead of a live GitHub runner bundle", () => {
    const configStub = fs.readFileSync(
      path.resolve("scripts/smoke/actions-runner/config.sh"),
      "utf8"
    );
    const runStub = fs.readFileSync(
      path.resolve("scripts/smoke/actions-runner/run.sh"),
      "utf8"
    );

    expect(configStub).toContain("config-invocations.log");
    expect(configStub).toContain("touch .runner .credentials .credentials_rsaparams");
    expect(runStub).toContain("run.sh stub executed");
    expect(runStub).toContain("job output");
  });
});
