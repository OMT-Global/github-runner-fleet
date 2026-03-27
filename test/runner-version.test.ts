import { describe, expect, test } from "vitest";
import {
  buildRunnerAssetName,
  buildRunnerDownloadUrl,
  compareRunnerVersions,
  summarizeRunnerVersion
} from "../src/lib/runner-version.js";

describe("runner version helpers", () => {
  test("compares semantic runner versions", () => {
    expect(compareRunnerVersions("2.327.1", "2.326.0")).toBe(1);
    expect(compareRunnerVersions("2.327.1", "2.327.1")).toBe(0);
    expect(compareRunnerVersions("2.325.0", "2.327.1")).toBe(-1);
  });

  test("builds release asset names and URLs", () => {
    expect(buildRunnerAssetName("2.327.1", "amd64")).toBe(
      "actions-runner-linux-x64-2.327.1.tar.gz"
    );
    expect(buildRunnerDownloadUrl("2.327.1", "arm64")).toBe(
      "https://github.com/actions/runner/releases/download/v2.327.1/actions-runner-linux-arm64-2.327.1.tar.gz"
    );
  });

  test("flags outdated runner versions", () => {
    expect(summarizeRunnerVersion("2.325.0", "2.327.1")).toEqual({
      current: "2.325.0",
      latest: "2.327.1",
      outdated: true
    });
  });
});
