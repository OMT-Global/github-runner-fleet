import { describe, expect, test } from "vitest";
import { decideAutoscale } from "../src/lib/autoscale.js";

const scaling = {
  min: 2,
  max: 4,
  queueThreshold: 3,
  cooldownSeconds: 120
};

describe("decideAutoscale", () => {
  test("scales up when queued jobs reach the configured threshold", () => {
    expect(
      decideAutoscale({
        poolKey: "synology-private",
        currentSize: 2,
        queuedJobs: 3,
        scaling,
        cooldownElapsedSeconds: 0
      })
    ).toEqual(
      expect.objectContaining({
        action: "scale-up",
        targetSize: 3
      })
    );
  });

  test("does not scale up beyond max", () => {
    expect(
      decideAutoscale({
        poolKey: "synology-private",
        currentSize: 4,
        queuedJobs: 12,
        scaling,
        cooldownElapsedSeconds: 0
      })
    ).toEqual(
      expect.objectContaining({
        action: "none",
        targetSize: 4,
        reason: "queued jobs 12 did not trigger scaling"
      })
    );
  });

  test("never scales down below min", () => {
    expect(
      decideAutoscale({
        poolKey: "synology-private",
        currentSize: 2,
        queuedJobs: 0,
        scaling,
        cooldownElapsedSeconds: 500
      })
    ).toEqual(
      expect.objectContaining({
        action: "none",
        targetSize: 2
      })
    );
  });

  test("does not scale down inside the cooldown window", () => {
    expect(
      decideAutoscale({
        poolKey: "synology-private",
        currentSize: 3,
        queuedJobs: 0,
        scaling,
        cooldownElapsedSeconds: 30
      })
    ).toEqual(
      expect.objectContaining({
        action: "none",
        targetSize: 3,
        reason: "cooldown has 90s remaining"
      })
    );
  });

  test("scales down one slot after an empty queue and elapsed cooldown", () => {
    expect(
      decideAutoscale({
        poolKey: "synology-private",
        currentSize: 4,
        queuedJobs: 0,
        scaling,
        cooldownElapsedSeconds: 120
      })
    ).toEqual(
      expect.objectContaining({
        action: "scale-down",
        targetSize: 3
      })
    );
  });

  test("does nothing when scaling is not configured", () => {
    expect(
      decideAutoscale({
        poolKey: "synology-private",
        currentSize: 3,
        queuedJobs: 10,
        cooldownElapsedSeconds: 120
      })
    ).toEqual(
      expect.objectContaining({
        action: "none",
        targetSize: 3
      })
    );
  });
});
