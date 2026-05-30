import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { log } from "./logger.js";

export interface WorkflowJobWebhookPayload {
  action?: string;
  workflow_job?: {
    id?: number;
    labels?: string[];
  };
}

export interface AutoscaleWebhookEvent {
  action: "queued" | "completed" | "in_progress";
  jobId: number;
  labels: string[];
}

export interface AutoscaleWebhookDecision {
  accepted: boolean;
  signal: "scale-up" | "scale-down" | "none";
  reason: string;
  event?: AutoscaleWebhookEvent;
}

export interface AutoscaleWebhookState {
  lastEventAt: string;
  lastSignal: "scale-up" | "scale-down" | "none";
  lastJobId: number;
}

export function verifyWebhookSignature(input: {
  body: Buffer | string;
  signatureHeader: string | undefined;
  secret: string;
}): boolean {
  if (!input.signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = `sha256=${crypto
    .createHmac("sha256", input.secret)
    .update(input.body)
    .digest("hex")}`;
  return timingSafeEqual(expected, input.signatureHeader);
}

export function evaluateWorkflowJobWebhook(input: {
  payload: WorkflowJobWebhookPayload;
  ownedLabels: string[];
  seenJobIds?: Set<number>;
}): AutoscaleWebhookDecision {
  const action = input.payload.action;
  const job = input.payload.workflow_job;
  if (action !== "queued" && action !== "completed" && action !== "in_progress") {
    return {
      accepted: false,
      signal: "none",
      reason: `ignored workflow_job action ${action ?? "unknown"}`
    };
  }
  if (typeof job?.id !== "number") {
    return {
      accepted: false,
      signal: "none",
      reason: "workflow_job payload did not include a numeric id"
    };
  }
  const labels = Array.isArray(job.labels)
    ? job.labels.filter((label): label is string => typeof label === "string")
    : [];
  const ownsJob = input.ownedLabels.every((label) => labels.includes(label));
  if (!ownsJob) {
    return {
      accepted: false,
      signal: "none",
      reason: "workflow_job labels do not target this fleet"
    };
  }
  if (input.seenJobIds?.has(job.id)) {
    return {
      accepted: true,
      signal: "none",
      reason: `workflow_job ${job.id} was already processed`,
      event: { action, jobId: job.id, labels }
    };
  }
  input.seenJobIds?.add(job.id);

  return {
    accepted: true,
    signal: action === "queued" ? "scale-up" : action === "completed" ? "scale-down" : "none",
    reason: `workflow_job ${action} event matched fleet labels`,
    event: { action, jobId: job.id, labels }
  };
}

export function writeAutoscaleWebhookState(
  filePath: string,
  decision: AutoscaleWebhookDecision,
  now = new Date()
): void {
  if (!decision.event) {
    return;
  }
  const state: AutoscaleWebhookState = {
    lastEventAt: now.toISOString(),
    lastSignal: decision.signal,
    lastJobId: decision.event.jobId
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function createAutoscaleWebhookServer(input: {
  secret: string;
  ownedLabels: string[];
  statePath?: string;
}): http.Server {
  const seenJobIds = new Set<number>();
  return http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end("method not allowed\n");
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      if (
        !verifyWebhookSignature({
          body,
          signatureHeader: request.headers["x-hub-signature-256"] as string | undefined,
          secret: input.secret
        })
      ) {
        log.warn("rejected workflow_job webhook with invalid signature");
        response.writeHead(401);
        response.end("invalid signature\n");
        return;
      }

      const eventName = request.headers["x-github-event"];
      if (eventName !== "workflow_job") {
        response.writeHead(202);
        response.end("ignored event\n");
        return;
      }

      const decision = evaluateWorkflowJobWebhook({
        payload: JSON.parse(body.toString("utf8")) as WorkflowJobWebhookPayload,
        ownedLabels: input.ownedLabels,
        seenJobIds
      });
      if (input.statePath) {
        writeAutoscaleWebhookState(input.statePath, decision);
      }
      log.info("processed workflow_job webhook", {
        accepted: decision.accepted,
        signal: decision.signal,
        reason: decision.reason
      });
      response.writeHead(decision.accepted ? 202 : 204);
      response.end(`${decision.signal}\n`);
    });
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}
