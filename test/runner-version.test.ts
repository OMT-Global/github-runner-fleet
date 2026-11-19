import { describe, expect, test } from "vitest";
import {
  assessRunnerFreshness,
  buildRunnerAssetName,
  buildRunnerDownloadUrl,
  compareRunnerVersions,
  readCanonicalRunnerVersion,
  runnerReleaseAgeDays,
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

  test("keeps current runner versions marked up to date", () => {
    expect(summarizeRunnerVersion("v2.327.1", "2.327.1")).toEqual({
      current: "2.327.1",
      latest: "2.327.1",
      outdated: false
    });
  });

  test("reads the canonical disabled-update runner version", () => {
    expect(readCanonicalRunnerVersion()).toBe("2.338.2");
  });

  test("computes whole days since the latest runner release", () => {
    expect(
      runnerReleaseAgeDays(
        "2026-06-09T01:32:05Z",
        new Date("2026-07-12T01:32:05Z")
      )
    ).toBe(33);
  });
});

describe("runner freshness against GitHub's disabled-update window", () => {
  const releases = [
    { version: "2.338.2", publishedAt: "2026-10-26T14:45:12Z" },
    { version: "2.338.1", publishedAt: "2026-10-22T14:14:46Z", prerelease: true },
    { version: "2.338.0", publishedAt: "2026-10-06T13:55:11Z" },
    { version: "2.337.0", publishedAt: "2026-08-26T14:33:29Z" },
    { version: "2.339.0", publishedAt: "2026-11-16T00:00:00Z", draft: true }
  ];
  const now = new Date("2026-11-17T12:00:00Z");

  test("starts the clock at the first stable release newer than current", () => {
    expect(assessRunnerFreshness("2.337.0", releases, now)).toEqual({
      current: "2.337.0",
      latest: "2.338.2",
      outdated: true,
      supersededBy: "2.338.0",
      supersededAt: "2026-10-06T13:55:11Z",
      ageDays: 41,
      daysUntilCutoff: -11
    });
  });

  test("ignores prereleases and drafts when starting the clock", () => {
    expect(assessRunnerFreshness("2.338.0", releases, now)).toMatchObject({
      latest: "2.338.2",
      supersededBy: "2.338.2",
      ageDays: 21,
      daysUntilCutoff: 9
    });
  });

  test("reports no clock when current is latest or newer", () => {
    expect(assessRunnerFreshness("v2.338.2", releases, now)).toEqual({
      current: "2.338.2",
      latest: "2.338.2",
      outdated: false
    });
    expect(assessRunnerFreshness("2.400.0", releases, now)).toMatchObject({
      outdated: false
    });
  });

  test("leaves age unknown rather than guessing when a newer release lacks a date", () => {
    expect(
      assessRunnerFreshness(
        "2.337.0",
        [{ version: "2.338.0" }, { version: "2.338.2", publishedAt: "2026-10-26T14:45:12Z" }],
        now
      )
    ).toMatchObject({ outdated: true, supersededBy: "2.338.0", ageDays: undefined });
  });

  test("refuses to assess without any stable release", () => {
    expect(() =>
      assessRunnerFreshness("2.337.0", [{ version: "2.338.1", prerelease: true }], now)
    ).toThrow(/no stable/);
  });
});
