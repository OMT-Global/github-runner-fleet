import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AutoscaleWebhookStateStore,
  createAutoscaleWebhookServer,
  evaluateWorkflowJobWebhook,
  verifyWebhookSignature,
  webhookEventKey
} from "../src/lib/autoscale-webhook.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("autoscale webhook", () => {
  test("verifies workflow_job signatures with HMAC SHA-256", () => {
    const body = JSON.stringify({ action: "queued" });
    const signature = `sha256=${crypto
      .createHmac("sha256", "secret")
      .update(body)
      .digest("hex")}`;

    expect(
      verifyWebhookSignature({
        body,
        signatureHeader: signature,
        secret: "secret"
      })
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        body,
        signatureHeader: signature,
        secret: "wrong"
      })
    ).toBe(false);
  });

  test("turns the same job lifecycle into independent scale signals", () => {
    const queued = evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        payload: {
          action: "queued",
          workflow_job: {
            id: 42,
            labels: ["self-hosted", "synology", "shell-only"]
          }
        }
      });
    expect(queued).toMatchObject({
      accepted: true,
      signal: "scale-up"
    });
    expect(
      evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        payload: {
          action: "in_progress",
          workflow_job: {
            id: 42,
            labels: ["self-hosted", "synology", "shell-only"]
          }
        }
      })
    ).toMatchObject({
      accepted: true,
      signal: "none",
      event: { action: "in_progress", jobId: 42 }
    });
    expect(
      evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        payload: {
          action: "completed",
          workflow_job: {
            id: 42,
            labels: ["self-hosted", "synology"]
          }
        }
      })
    ).toMatchObject({
      accepted: true,
      signal: "scale-down"
    });
    expect(webhookEventKey(queued)).toBe("job:42:queued");
    expect(webhookEventKey(queued, "delivery-1")).toBe("delivery:delivery-1");
  });

  test("bounds and persists dedupe state across restarts", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "autoscale-webhook-"));
    tempDirectories.push(directory);
    const statePath = path.join(directory, "state.json");
    const decision = evaluateWorkflowJobWebhook({
      ownedLabels: ["self-hosted"],
      payload: { action: "queued", workflow_job: { id: 42, labels: ["self-hosted"] } }
    });
    const first = new AutoscaleWebhookStateStore({
      filePath: statePath,
      ttlMs: 1_000,
      maxProcessed: 2,
      now: 0
    });
    first.record("delivery:one", decision, new Date(100));
    first.record("delivery:two", decision, new Date(200));
    first.record("delivery:three", decision, new Date(300));

    const restarted = new AutoscaleWebhookStateStore({
      filePath: statePath,
      ttlMs: 1_000,
      maxProcessed: 2,
      now: 300
    });
    expect(restarted.has("delivery:one", 300)).toBe(false);
    expect(restarted.has("delivery:two", 300)).toBe(true);
    expect(restarted.has("delivery:three", 1_301)).toBe(false);
    expect(JSON.parse(fs.readFileSync(statePath, "utf8")).processed).toHaveLength(2);
  });

  test("actuates each lifecycle signal once and dedupes replay deliveries", async () => {
    const decisions: string[] = [];
    const server = createAutoscaleWebhookServer({
      secret: "secret",
      routes: [{ poolKey: "synology-public", labels: ["self-hosted", "public"] }],
      onDecision: vi.fn(async (decision) => {
        decisions.push(`${decision.event?.jobId}:${decision.signal}`);
      })
    });
    await listen(server);
    try {
      expect((await postWorkflowJob(server, "queued", 42, "delivery-q")).status).toBe(202);
      expect((await postWorkflowJob(server, "queued", 42, "delivery-q")).body).toBe("none\n");
      expect((await postWorkflowJob(server, "in_progress", 42, "delivery-i")).body).toBe("none\n");
      expect((await postWorkflowJob(server, "completed", 42, "delivery-c")).status).toBe(202);
      expect(decisions).toEqual(["42:scale-up", "42:scale-down"]);
    } finally {
      await close(server);
    }
  });

  test("returns 500 and permits delivery retry when actuation fails", async () => {
    let attempts = 0;
    const server = createAutoscaleWebhookServer({
      secret: "secret",
      ownedLabels: ["self-hosted"],
      onDecision: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary controller failure");
      }
    });
    await listen(server);
    try {
      expect((await postWorkflowJob(server, "queued", 42, "retry-me")).status).toBe(500);
      expect((await postWorkflowJob(server, "queued", 42, "retry-me")).status).toBe(202);
      expect(attempts).toBe(2);
    } finally {
      await close(server);
    }
  });

  test("ignores jobs for other runner labels", () => {
    expect(
      evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        payload: {
          action: "queued",
          workflow_job: {
            id: 44,
            labels: ["ubuntu-latest"]
          }
        }
      })
    ).toMatchObject({
      accepted: false,
      signal: "none"
    });
  });

  test("rejects malformed signed JSON with a controlled 400", async () => {
    const server = createAutoscaleWebhookServer({
      secret: "secret",
      ownedLabels: ["self-hosted", "synology"]
    });
    await listen(server);
    try {
      const response = await postWebhook(server, {
        body: "{not-json",
        secret: "secret"
      });
      expect(response.status).toBe(400);
      expect(response.body).toBe("malformed json\n");
    } finally {
      await close(server);
    }
  });

  test("rejects oversized payloads before authentication work", async () => {
    const server = createAutoscaleWebhookServer({
      secret: "secret",
      ownedLabels: ["self-hosted", "synology"],
      maxBodyBytes: 8
    });
    await listen(server);
    try {
      const response = await postWebhook(server, {
        body: JSON.stringify({ action: "queued" }),
        secret: "secret"
      });
      expect(response.status).toBe(413);
      expect(response.body).toBe("payload too large\n");
    } finally {
      await close(server);
    }
  });
});

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postWebhook(
  server: http.Server,
  input: { body: string; secret: string; deliveryId?: string }
): Promise<{ status: number; body: string }> {
  const address = server.address() as AddressInfo;
  const signature = `sha256=${crypto
    .createHmac("sha256", input.secret)
    .update(input.body)
    .digest("hex")}`;

  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "/",
        headers: {
          "content-length": Buffer.byteLength(input.body),
          "x-github-event": "workflow_job",
          "x-hub-signature-256": signature,
          ...(input.deliveryId ? { "x-github-delivery": input.deliveryId } : {})
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    request.on("error", reject);
    request.end(input.body);
  });
}

async function postWorkflowJob(
  server: http.Server,
  action: "queued" | "in_progress" | "completed",
  jobId: number,
  deliveryId: string
): Promise<{ status: number; body: string }> {
  const body = JSON.stringify({
    action,
    workflow_job: { id: jobId, labels: ["self-hosted", "linux", "public"] }
  });
  return postWebhook(server, { body, secret: "secret", deliveryId });
}
