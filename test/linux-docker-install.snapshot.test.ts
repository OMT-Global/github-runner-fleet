import { describe, expect, test } from "vitest";
import { renderLinuxDockerCompose } from "../src/lib/linux-docker-compose.js";
import { buildLinuxDockerInstallPlan } from "../src/lib/linux-docker-install.js";
import {
  deploymentEnvFixture,
  linuxDockerConfigFixture
} from "./fixtures/rendered-artifacts.js";

describe("buildLinuxDockerInstallPlan snapshots", () => {
  test("locks the full Linux Docker install plan JSON shape", () => {
    const env = deploymentEnvFixture();
    const config = linuxDockerConfigFixture();

    expect(
      buildLinuxDockerInstallPlan(
        config,
        env,
        renderLinuxDockerCompose(config, env)
      )
    ).toMatchSnapshot();
  });
});
