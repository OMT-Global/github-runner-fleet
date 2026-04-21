import { describe, expect, test } from "vitest";
import { renderCompose } from "../src/lib/compose.js";
import {
  deploymentEnvFixture,
  synologyConfigFixture
} from "./fixtures/rendered-artifacts.js";

describe("renderCompose snapshots", () => {
  test("locks the full Synology docker-compose YAML", () => {
    expect(
      renderCompose(synologyConfigFixture(), deploymentEnvFixture())
    ).toMatchSnapshot();
  });
});
