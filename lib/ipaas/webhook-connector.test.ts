import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import {
  webhookConnector,
  webhookToInboundMessage,
  verifyWebhookSignature,
  parseWebhookInbound,
} from "@/lib/ipaas/webhook-connector";
import { getConnector, isPlatformRegistered } from "@/lib/ipaas/connector-registry";

describe("webhook-connector", () => {
  describe("verifyWebhookSignature", () => {
    it("returns true for valid signature", () => {
      const body = '{"event":"test"}';
      const secret = "my-secret";
      const expected = `v1=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
      expect(verifyWebhookSignature(body, expected, secret)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      expect(verifyWebhookSignature('{"event":"test"}', "v1=invalid", "my-secret")).toBe(false);
    });

    it("returns false when signature is null", () => {
      expect(verifyWebhookSignature("body", null, "secret")).toBe(false);
    });

    it("returns false when secret is empty", () => {
      const sig = `v1=${createHmac("sha256", "").update("body", "utf8").digest("hex")}`;
      expect(verifyWebhookSignature("body", sig, "")).toBe(false);
    });
  });

  describe("parseWebhookInbound", () => {
    it("parses JSON body", () => {
      const body = JSON.stringify({ event: "order.created", data: { id: 123 } });
      const result = parseWebhookInbound(body, { "x-webhook-source": "shopify" });
      expect(result).not.toBeNull();
      expect(result!.source).toBe("shopify");
      expect(result!.event).toBe("order.created");
      expect(result!.payload).toEqual({ event: "order.created", data: { id: 123 } });
    });

    it("wraps non-JSON body", () => {
      const result = parseWebhookInbound("plain text", {});
      expect(result).not.toBeNull();
      expect(result!.payload).toEqual({ raw: "plain text" });
    });

    it("extracts event from payload when header missing", () => {
      const body = JSON.stringify({ event: "push" });
      const result = parseWebhookInbound(body, {});
      expect(result!.event).toBe("push");
    });

    it("defaults event to 'webhook' when not found", () => {
      const body = JSON.stringify({ data: "test" });
      const result = parseWebhookInbound(body, {});
      expect(result!.event).toBe("webhook");
    });

    it("uses x-request-id for messageId when x-webhook-id absent", () => {
      const result = parseWebhookInbound("{}", { "x-request-id": "req_123" });
      expect(result!.messageId).toBe("req_123");
    });
  });

  describe("webhookConnector", () => {
    it("has platform 'webhook'", () => {
      expect(webhookConnector.platform).toBe("webhook");
    });

    it("validateInbound passes when no secret configured", () => {
      const body = JSON.stringify({ event: "test" });
      const result = webhookConnector.validateInbound({
        body, headers: {}, connectorId: "ipc_wh_test", credentials: {},
      });
      expect(result).not.toBeNull();
    });

    it("validateInbound rejects when signature is invalid", () => {
      const body = JSON.stringify({ event: "test" });
      const result = webhookConnector.validateInbound({
        body,
        headers: { "x-webhook-signature": "v1=invalid" },
        connectorId: "ipc_wh_test",
        credentials: { secret: "my-secret" },
      });
      expect(result).toBeNull();
    });

    it("validateInbound passes with valid signature", () => {
      const body = JSON.stringify({ event: "test" });
      const secret = "my-secret";
      const sig = `v1=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
      const result = webhookConnector.validateInbound({
        body,
        headers: { "x-webhook-signature": sig },
        connectorId: "ipc_wh_test",
        credentials: { secret },
      });
      expect(result).not.toBeNull();
    });

    it("sendOutbound rejects invalid URL", async () => {
      const result = await webhookConnector.sendOutbound(
        { connectorId: "ipc_test", workspaceId: "ws_test", platform: "webhook", name: "test", inboundEnabled: false, outboundEnabled: true, linkedAutomationId: null, status: "active", credentials: {} as Record<string, string> },
        { to: "not-a-url", text: "Hello" },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("有效 URL");
    });
  });

  describe("webhookToInboundMessage", () => {
    it("converts string payload", () => {
      const result = webhookToInboundMessage({
        messageId: "wh_001", source: "github", event: "push", payload: "Hello",
      });
      expect(result.text).toBe("Hello");
      expect(result.platform).toBe("webhook");
      expect(result.actor).toBe("github");
      expect(result.channel).toBe("push");
    });

    it("converts object payload with formatting", () => {
      const result = webhookToInboundMessage({
        messageId: "wh_002", source: "github", event: "push", payload: { ref: "main" },
      });
      expect(result.text).toContain("[Webhook: push]");
      expect(result.text).toContain("来源: github");
      expect(result.text).toContain("\"ref\": \"main\"");
    });
  });

  describe("webhook connector registry", () => {
    it("webhook is registered", () => {
      expect(isPlatformRegistered("webhook")).toBe(true);
    });

    it("getConnector returns webhook connector", () => {
      const connector = getConnector("webhook");
      expect(connector).toBeDefined();
      expect(connector!.platform).toBe("webhook");
    });
  });
});
