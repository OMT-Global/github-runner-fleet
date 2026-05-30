import crypto from "node:crypto";
import { describe, expect, test } from "vitest";
import {
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
});
