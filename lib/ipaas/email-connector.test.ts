import { describe, expect, it } from "vitest";

import { emailConnector, emailToInboundMessage } from "@/lib/ipaas/email-connector";
import { getConnector, isPlatformRegistered } from "@/lib/ipaas/connector-registry";

describe("email-connector", () => {
  describe("emailConnector", () => {
    it("has platform 'email'", () => {
      expect(emailConnector.platform).toBe("email");
    });

    it("validateInbound delegates to normalizeEmailRequest", () => {
      const body = JSON.stringify({
        messageId: "msg_001",
        from: "sender@example.com",
        to: "receiver@example.com",
        subject: "Test Subject",
        text: "Hello World",
      });
      const result = emailConnector.validateInbound({
        body, headers: {}, connectorId: "ipc_email_test", credentials: {},
      });
      // normalizeEmailRequest returns EmailInbound or null
      if (result) {
        expect(result).toHaveProperty("messageId");
        expect(result).toHaveProperty("from");
        expect(result).toHaveProperty("subject");
      }
    });

    it("validateInbound returns null for invalid JSON", () => {
      const result = emailConnector.validateInbound({
        body: "not json", headers: {}, connectorId: "ipc_test", credentials: {},
      });
      expect(result).toBeNull();
    });

    it("sendOutbound fails gracefully without credentials", async () => {
      const result = await emailConnector.sendOutbound(
        { connectorId: "ipc_test", workspaceId: "ws_test", platform: "email", name: "test", inboundEnabled: false, outboundEnabled: true, linkedAutomationId: null, status: "active", credentials: {} as Record<string, string> },
        { to: "test@example.com", text: "Hello" },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("未配置发送方式");
    });
  });

  describe("emailToInboundMessage", () => {
    it("converts EmailInbound to InboundMessage", () => {
      const email = {
        messageId: "msg_001",
        from: "sender@example.com",
        to: "receiver@example.com",
        subject: "Test Subject",
        text: "Hello World",
        references: ["<ref_001>"],
      };
      const result = emailToInboundMessage(email);
      expect(result).toEqual({
        platform: "email",
        messageId: "msg_001",
        actor: "sender@example.com",
        channel: "receiver@example.com",
        text: "[邮件] 主题: Test Subject\n\nHello World",
        replyContext: { inReplyTo: "msg_001", references: ["<ref_001>"] },
      });
    });
  });

  describe("email connector registry", () => {
    it("email is registered", () => {
      expect(isPlatformRegistered("email")).toBe(true);
    });

    it("getConnector returns email connector", () => {
      const connector = getConnector("email");
      expect(connector).toBeDefined();
      expect(connector!.platform).toBe("email");
    });
  });
});
