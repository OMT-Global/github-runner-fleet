import { describe, expect, test } from "vitest";
import { renderWindowsDockerCompose } from "../src/lib/windows-compose.js";
import { buildWindowsDockerInstallPlan } from "../src/lib/windows-install.js";
import {
  deploymentEnvFixture,
  windowsDockerConfigFixture
} from "./fixtures/rendered-artifacts.js";

describe("buildWindowsDockerInstallPlan snapshots", () => {
  test("locks the full Windows Docker install plan JSON shape", () => {
    const env = deploymentEnvFixture();
    const config = windowsDockerConfigFixture();

    expect(
      buildWindowsDockerInstallPlan(
        config,
        env,
        renderWindowsDockerCompose(config, env)
      )
    ).toMatchSnapshot();
  });
});
