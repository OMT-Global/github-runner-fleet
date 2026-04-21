import { describe, expect, test } from "vitest";
import { renderCompose } from "../src/lib/compose.js";
import { buildSynologyInstallPlan } from "../src/lib/synology-install.js";
import {
  deploymentEnvFixture,
  synologyConfigFixture
} from "./fixtures/rendered-artifacts.js";

describe("buildSynologyInstallPlan snapshots", () => {
  test("locks the full Synology install plan JSON shape", () => {
    const env = deploymentEnvFixture();
    const config = synologyConfigFixture();

    expect(
      buildSynologyInstallPlan(config, env, renderCompose(config, env))
    ).toMatchSnapshot();
  });
});
