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

export interface AutoscaleWebhookRoute {
  poolKey: string;
  labels: string[];
}

export interface AutoscaleWebhookEvent {
  action: "queued" | "completed" | "in_progress";
  jobId: number;
  labels: string[];
  poolKey: string;
}

export interface AutoscaleWebhookDecision {
  accepted: boolean;
  signal: "scale-up" | "scale-down" | "none";
  reason: string;
  event?: AutoscaleWebhookEvent;
}

export interface AutoscaleWebhookState {
  version: 1;
  lastEventAt: string;
  lastSignal: "scale-up" | "scale-down" | "none";
  lastJobId: number;
  lastPoolKey: string;
  processed: Array<{ key: string; processedAt: string }>;
}

export const DEFAULT_AUTOSCALE_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_AUTOSCALE_WEBHOOK_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTOSCALE_WEBHOOK_MAX_PROCESSED = 2_048;

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
  routes?: AutoscaleWebhookRoute[];
  ownedLabels?: string[];
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
  const routes = input.routes ?? [
    { poolKey: "default", labels: input.ownedLabels ?? [] }
  ];
  const route = routes
    .filter((candidate) => candidate.labels.every((label) => labels.includes(label)))
    .sort((left, right) => right.labels.length - left.labels.length)[0];
  if (!route || route.labels.length === 0) {
    return {
      accepted: false,
      signal: "none",
      reason: "workflow_job labels do not target this fleet"
    };
  }

  return {
    accepted: true,
    signal: action === "queued" ? "scale-up" : action === "completed" ? "scale-down" : "none",
    reason: `workflow_job ${action} event matched pool ${route.poolKey}`,
    event: { action, jobId: job.id, labels, poolKey: route.poolKey }
  };
}

export function webhookEventKey(
  decision: AutoscaleWebhookDecision,
  deliveryId?: string
): string | undefined {
  if (!decision.event) {
    return undefined;
  }
  return deliveryId?.trim()
    ? `delivery:${deliveryId.trim()}`
    : `job:${decision.event.jobId}:${decision.event.action}`;
}

export class AutoscaleWebhookStateStore {
  readonly #filePath?: string;
  readonly #ttlMs: number;
  readonly #maxProcessed: number;
  readonly #processed = new Map<string, number>();
  #lastState?: AutoscaleWebhookState;

  constructor(input: {
    filePath?: string;
    ttlMs?: number;
    maxProcessed?: number;
    now?: number;
  }) {
    this.#filePath = input.filePath;
    this.#ttlMs = input.ttlMs ?? DEFAULT_AUTOSCALE_WEBHOOK_DEDUPE_TTL_MS;
    this.#maxProcessed = input.maxProcessed ?? DEFAULT_AUTOSCALE_WEBHOOK_MAX_PROCESSED;
    this.#load(input.now ?? Date.now());
  }

  has(key: string, now = Date.now()): boolean {
    this.#prune(now);
    return this.#processed.has(key);
  }

  record(
    key: string,
    decision: AutoscaleWebhookDecision,
    now = new Date()
  ): void {
    if (!decision.event) {
      return;
    }
    const timestamp = now.getTime();
    this.#processed.set(key, timestamp);
    this.#prune(timestamp);
    const processed = [...this.#processed.entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([processedKey, processedAt]) => ({
        key: processedKey,
        processedAt: new Date(processedAt).toISOString()
      }));
    this.#lastState = {
      version: 1,
      lastEventAt: now.toISOString(),
      lastSignal: decision.signal,
      lastJobId: decision.event.jobId,
      lastPoolKey: decision.event.poolKey,
      processed
    };
    if (this.#filePath) {
      writeStateAtomic(this.#filePath, this.#lastState);
    }
  }

  #load(now: number): void {
    if (!this.#filePath || !fs.existsSync(this.#filePath)) {
      return;
    }
    try {
      const state = JSON.parse(fs.readFileSync(this.#filePath, "utf8")) as Partial<AutoscaleWebhookState>;
      for (const entry of state.processed ?? []) {
        const processedAt = Date.parse(entry.processedAt);
        if (entry.key && Number.isFinite(processedAt)) {
          this.#processed.set(entry.key, processedAt);
        }
      }
      this.#prune(now);
    } catch (error) {
      log.warn("ignored unreadable autoscale webhook state", {
        statePath: this.#filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  #prune(now: number): void {
    for (const [key, processedAt] of this.#processed) {
      if (now - processedAt > this.#ttlMs) {
        this.#processed.delete(key);
      }
    }
    const overflow = this.#processed.size - this.#maxProcessed;
    if (overflow > 0) {
      for (const [key] of [...this.#processed.entries()]
        .sort((left, right) => left[1] - right[1])
        .slice(0, overflow)) {
        this.#processed.delete(key);
      }
    }
  }
}

export function createAutoscaleWebhookServer(input: {
  secret: string;
  routes?: AutoscaleWebhookRoute[];
  ownedLabels?: string[];
  statePath?: string;
  maxBodyBytes?: number;
  dedupeTtlMs?: number;
  maxProcessed?: number;
  onDecision?: (decision: AutoscaleWebhookDecision) => Promise<void>;
}): http.Server {
  const store = new AutoscaleWebhookStateStore({
    filePath: input.statePath,
    ttlMs: input.dedupeTtlMs,
    maxProcessed: input.maxProcessed
  });
  const inFlight = new Set<string>();
  const maxBodyBytes = input.maxBodyBytes ?? DEFAULT_AUTOSCALE_WEBHOOK_MAX_BODY_BYTES;
  return http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405);
      response.end("method not allowed\n");
      return;
    }

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      const buffer = Buffer.from(chunk);
      bodyBytes += buffer.byteLength;
      if (bodyBytes > maxBodyBytes) {
        rejected = true;
        chunks.length = 0;
        log.warn("rejected workflow_job webhook payload over size limit", { maxBodyBytes });
        response.shouldKeepAlive = false;
        response.on("finish", () => request.destroy());
        response.writeHead(413);
        response.end("payload too large\n");
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (rejected) return;
      void processRequest().catch((error) => {
        log.error("failed to process workflow_job webhook", {
          error: error instanceof Error ? error.message : String(error)
        });
        if (!response.headersSent) {
          response.writeHead(500);
          response.end("actuation failed\n");
        }
      });

      async function processRequest(): Promise<void> {
        const body = Buffer.concat(chunks);
        if (!verifyWebhookSignature({
          body,
          signatureHeader: request.headers["x-hub-signature-256"] as string | undefined,
          secret: input.secret
        })) {
          log.warn("rejected workflow_job webhook with invalid signature");
          response.writeHead(401);
          response.end("invalid signature\n");
          return;
        }
        if (request.headers["x-github-event"] !== "workflow_job") {
          response.writeHead(202);
          response.end("ignored event\n");
          return;
        }

        let payload: WorkflowJobWebhookPayload;
        try {
          payload = JSON.parse(body.toString("utf8")) as WorkflowJobWebhookPayload;
        } catch {
          log.warn("rejected workflow_job webhook with malformed JSON");
          response.writeHead(400);
          response.end("malformed json\n");
          return;
        }

        const decision = evaluateWorkflowJobWebhook({
          payload,
          routes: input.routes,
          ownedLabels: input.ownedLabels
        });
        const deliveryHeader = request.headers["x-github-delivery"];
        const deliveryId = Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader;
        const eventKey = webhookEventKey(decision, deliveryId);
        if (eventKey && (store.has(eventKey) || inFlight.has(eventKey))) {
          response.writeHead(202);
          response.end("none\n");
          return;
        }

        if (eventKey) inFlight.add(eventKey);
        try {
          if (decision.accepted && decision.signal !== "none") {
            await input.onDecision?.(decision);
          }
          if (eventKey) store.record(eventKey, decision);
        } finally {
          if (eventKey) inFlight.delete(eventKey);
        }
        log.info("processed workflow_job webhook", {
          accepted: decision.accepted,
          signal: decision.signal,
          reason: decision.reason,
          pool: decision.event?.poolKey,
          deliveryId
        });
        response.writeHead(decision.accepted ? 202 : 204);
        response.end(`${decision.signal}\n`);
      }
    });
    request.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(400);
        response.end("request error\n");
      }
    });
  });
}

function writeStateAtomic(filePath: string, state: AutoscaleWebhookState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
