import { describe, expect, test } from "vitest";
import {
  decideLinuxReconcile,
  emptyLinuxReconcileState,
  parseLinuxReconcileState
} from "../src/lib/reconcile.js";

describe("Linux pool reconciliation", () => {
  test("applies when no successful reconciliation is recorded", () => {
    expect(
      decideLinuxReconcile({
        desiredImageRef: "ghcr.io/example/fleet:1.2.3",
        verifiedVersionId: 42
      })
    ).toEqual({ action: "apply", reason: "missing-state" });
  });

  test("skips duplicate release signals for the verified image", () => {
    expect(
      decideLinuxReconcile({
        current: {
          imageRef: "ghcr.io/example/fleet:1.2.3",
          versionId: 42,
          reconciledAt: "2026-07-13T00:00:00Z"
        },
        desiredImageRef: "ghcr.io/example/fleet:1.2.3",
        verifiedVersionId: 42
      })
    ).toEqual({ action: "skip", reason: "already-current" });
  });

  test("reconciles when the package version behind a tag changes", () => {
    expect(
      decideLinuxReconcile({
        current: {
          imageRef: "ghcr.io/example/fleet:stable",
          versionId: 41,
          reconciledAt: "2026-07-13T00:00:00Z"
        },
        desiredImageRef: "ghcr.io/example/fleet:stable",
        verifiedVersionId: 42
      })
    ).toEqual({ action: "apply", reason: "image-changed" });
  });

  test("rejects malformed state instead of mutating a pool", () => {
    expect(() => parseLinuxReconcileState({ version: 2, planes: {} })).toThrow(
      "version 1"
    );
    expect(emptyLinuxReconcileState()).toEqual({ version: 1, planes: {} });
  });
});
