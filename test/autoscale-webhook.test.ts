import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import {
  createAutoscaleWebhookServer,
  evaluateWorkflowJobWebhook,
  verifyWebhookSignature
} from "../src/lib/autoscale-webhook.js";

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

  test("turns matching queued and completed events into scale signals", () => {
    const seenJobIds = new Set<number>();
    expect(
      evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        seenJobIds,
        payload: {
          action: "queued",
          workflow_job: {
            id: 42,
            labels: ["self-hosted", "synology", "shell-only"]
          }
        }
      })
    ).toMatchObject({
      accepted: true,
      signal: "scale-up"
    });
    expect(
      evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        seenJobIds,
        payload: {
          action: "queued",
          workflow_job: {
            id: 42,
            labels: ["self-hosted", "synology", "shell-only"]
          }
        }
      })
    ).toMatchObject({
      accepted: true,
      signal: "none",
      reason: "workflow_job 42 was already processed"
    });
    expect(
      evaluateWorkflowJobWebhook({
        ownedLabels: ["self-hosted", "synology"],
        payload: {
          action: "completed",
          workflow_job: {
            id: 43,
            labels: ["self-hosted", "synology"]
          }
        }
      })
    ).toMatchObject({
      accepted: true,
      signal: "scale-down"
    });
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
  input: { body: string; secret: string }
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
          "x-hub-signature-256": signature
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
