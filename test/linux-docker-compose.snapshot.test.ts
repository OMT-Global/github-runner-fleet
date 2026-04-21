import { describe, expect, test } from "vitest";
import { renderLinuxDockerCompose } from "../src/lib/linux-docker-compose.js";
import {
  deploymentEnvFixture,
  linuxDockerConfigFixture
} from "./fixtures/rendered-artifacts.js";

describe("renderLinuxDockerCompose snapshots", () => {
  test("locks the full Linux Docker docker-compose YAML", () => {
    expect(
      renderLinuxDockerCompose(linuxDockerConfigFixture(), deploymentEnvFixture())
    ).toMatchSnapshot();
  });
});
