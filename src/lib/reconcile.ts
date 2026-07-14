export type LinuxReconcilePlane = "synology" | "linux-docker";

export interface ReconcilePlaneState {
  imageRef: string;
  versionId: number;
  reconciledAt: string;
}

export interface LinuxReconcileState {
  version: 1;
  planes: Partial<Record<LinuxReconcilePlane, ReconcilePlaneState>>;
}

export interface ReconcileDecision {
  action: "apply" | "skip";
  reason: "forced" | "missing-state" | "image-changed" | "already-current";
}

export function decideLinuxReconcile(input: {
  current?: ReconcilePlaneState;
  desiredImageRef: string;
  verifiedVersionId: number;
  force?: boolean;
}): ReconcileDecision {
  if (input.force) {
    return { action: "apply", reason: "forced" };
  }
  if (!input.current) {
    return { action: "apply", reason: "missing-state" };
  }
  if (
    input.current.imageRef !== input.desiredImageRef ||
    input.current.versionId !== input.verifiedVersionId
  ) {
    return { action: "apply", reason: "image-changed" };
  }
  return { action: "skip", reason: "already-current" };
}

export function emptyLinuxReconcileState(): LinuxReconcileState {
  return { version: 1, planes: {} };
}

export function parseLinuxReconcileState(value: unknown): LinuxReconcileState {
  if (!value || typeof value !== "object") {
    throw new Error("reconcile state must be an object");
  }
  const candidate = value as { version?: unknown; planes?: unknown };
  if (candidate.version !== 1 || !candidate.planes || typeof candidate.planes !== "object") {
    throw new Error("reconcile state must have version 1 and a planes object");
  }
  return value as LinuxReconcileState;
}
