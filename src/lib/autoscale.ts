import type { PoolScaling } from "./config.js";

export type AutoscaleAction = "scale-up" | "scale-down" | "none";

export interface AutoscaleDecisionInput {
  poolKey: string;
  currentSize: number;
  queuedJobs: number;
  scaling?: PoolScaling;
  cooldownElapsedSeconds: number;
}

export interface AutoscaleDecision {
  poolKey: string;
  action: AutoscaleAction;
  currentSize: number;
  targetSize: number;
  queuedJobs: number;
  reason: string;
}

export function decideAutoscale(
  input: AutoscaleDecisionInput
): AutoscaleDecision {
  const base = {
    poolKey: input.poolKey,
    currentSize: input.currentSize,
    targetSize: input.currentSize,
    queuedJobs: input.queuedJobs
  };

  if (!input.scaling) {
    return {
      ...base,
      action: "none",
      reason: "pool has no scaling configuration"
    };
  }

  if (
    input.queuedJobs >= input.scaling.queueThreshold &&
    input.currentSize < input.scaling.max
  ) {
    return {
      ...base,
      action: "scale-up",
      targetSize: Math.min(input.scaling.max, input.currentSize + 1),
      reason: `queued jobs ${input.queuedJobs} reached threshold ${input.scaling.queueThreshold}`
    };
  }

  if (input.queuedJobs > 0) {
    return {
      ...base,
      action: "none",
      reason: `queued jobs ${input.queuedJobs} did not trigger scaling`
    };
  }

  if (input.currentSize <= input.scaling.min) {
    return {
      ...base,
      action: "none",
      reason: `current size ${input.currentSize} is at or below minimum ${input.scaling.min}`
    };
  }

  if (input.cooldownElapsedSeconds < input.scaling.cooldownSeconds) {
    return {
      ...base,
      action: "none",
      reason: `cooldown has ${Math.ceil(
        input.scaling.cooldownSeconds - input.cooldownElapsedSeconds
      )}s remaining`
    };
  }

  return {
    ...base,
    action: "scale-down",
    targetSize: Math.max(input.scaling.min, input.currentSize - 1),
    reason: `queue is empty and cooldown ${input.scaling.cooldownSeconds}s elapsed`
  };
}
