import { describe, expect, it } from "vitest";

import {
  clearFeishuTokenCache,
  feishuConnector,
  feishuToInboundMessage,
  normalizeFeishuEvent,
  parseFeishuEvent,
  verifyFeishuToken,
} from "@/lib/ipaas/feishu-adapter";
import { getConnector, getRegisteredPlatforms, isPlatformRegistered } from "@/lib/ipaas/connector-registry";

describe("feishu-adapter", () => {
  describe("parseFeishuEvent", () => {
    it("parses plain JSON event", () => {
      const body = JSON.stringify({ type: "url_verification", challenge: "test-challenge" });
      const result = parseFeishuEvent(body);
      expect(result).toEqual({ type: "url_verification", challenge: "test-challenge" });
    });

    it("returns null for invalid JSON", () => {
      expect(parseFeishuEvent("not json")).toBeNull();
    });
  });

  describe("verifyFeishuToken", () => {
    it("returns true when token matches", () => {
      expect(verifyFeishuToken({ token: "abc123" }, "abc123")).toBe(true);
    });

    it("returns true for verification_token field", () => {
      expect(verifyFeishuToken({ verification_token: "abc123" }, "abc123")).toBe(true);
    });

    it("returns false when token does not match", () => {
      expect(verifyFeishuToken({ token: "wrong" }, "abc123")).toBe(false);
    });

    it("returns false when no token present", () => {
      expect(verifyFeishuToken({}, "abc123")).toBe(false);
    });
  });

  describe("normalizeFeishuEvent", () => {
    it("handles URL verification challenge", () => {
      const result = normalizeFeishuEvent({ type: "url_verification", challenge: "test-challenge-123" });
      expect(result).toEqual({ challenge: "test-challenge-123" });
    });

    it("normalizes message event", () => {
      const event = {
        type: "event_callback",
        event: {
          message: {
            message_id: "msg_001",
            chat_id: "oc_abc123",
            chat_type: "group",
            content: JSON.stringify({ text: "Hello World" }),
          },
          sender: { sender_id: { open_id: "ou_user001" } },
        },
      };
      const result = normalizeFeishuEvent(event);
      expect(result).toEqual({
        messageId: "msg_001",
        actor: "ou_user001",
        channel: "oc_abc123",
        text: "Hello World",
        chatType: "group",
        replyContext: { receiveId: "oc_abc123", receiveIdType: "chat_id" },
      });
    });

    it("handles p2p chat type", () => {
      const event = {
        type: "event_callback",
        event: {
          message: { message_id: "msg_002", chat_id: "oc_p2p", chat_type: "p2p", content: JSON.stringify({ text: "Direct message" }) },
          sender: { sender_id: { open_id: "ou_sender" } },
        },
      };
      const result = normalizeFeishuEvent(event);
      expect(result).not.toBeNull();
      expect((result as { chatType: string }).chatType).toBe("p2p");
    });

    it("returns null for unknown event type", () => {
      expect(normalizeFeishuEvent({ type: "unknown" })).toBeNull();
    });

    it("returns null when event field is missing", () => {
      expect(normalizeFeishuEvent({ type: "event_callback" })).toBeNull();
    });

    it("returns null when text is empty", () => {
      const event = {
        type: "event_callback",
        event: {
          message: { message_id: "msg_empty", chat_id: "oc_test", chat_type: "group", content: JSON.stringify({ text: "   " }) },
          sender: { sender_id: { open_id: "ou_user" } },
        },
      };
      expect(normalizeFeishuEvent(event)).toBeNull();
    });
  });

  describe("feishuToInboundMessage", () => {
    it("converts FeishuInbound to InboundMessage", () => {
      const feishu = {
        messageId: "msg_001", actor: "ou_user001", channel: "oc_abc123", text: "Hello",
        chatType: "group" as const, replyContext: { receiveId: "oc_abc123", receiveIdType: "chat_id" },
      };
      const result = feishuToInboundMessage(feishu);
      expect(result).toEqual({
        platform: "feishu", messageId: "msg_001", actor: "ou_user001", channel: "oc_abc123",
        text: "Hello", replyContext: { receiveId: "oc_abc123", receiveIdType: "chat_id" },
      });
    });
  });

  describe("feishuConnector", () => {
    it("has platform 'feishu'", () => {
      expect(feishuConnector.platform).toBe("feishu");
    });

    it("validateInbound returns challenge for URL verification", () => {
      const body = JSON.stringify({ type: "url_verification", challenge: "test-challenge", token: "my-token" });
      const result = feishuConnector.validateInbound({
        body, headers: {}, connectorId: "ipc_test", credentials: { verificationToken: "my-token" } as Record<string, string>,
      });
      expect(result).toEqual({ challenge: "test-challenge" });
    });

    it("validateInbound returns null when token is invalid", () => {
      const body = JSON.stringify({ type: "url_verification", challenge: "test", token: "wrong" });
      const result = feishuConnector.validateInbound({
        body, headers: {}, connectorId: "ipc_test", credentials: { verificationToken: "correct-token" } as Record<string, string>,
      });
      expect(result).toBeNull();
    });
  });

  describe("clearFeishuTokenCache", () => {
    it("clears without error", () => {
      expect(() => clearFeishuTokenCache()).not.toThrow();
    });
  });
});

describe("connector-registry", () => {
  it("feishu is registered", () => {
    expect(isPlatformRegistered("feishu")).toBe(true);
  });

  it("getConnector returns feishu connector", () => {
    const connector = getConnector("feishu");
    expect(connector).toBeDefined();
    expect(connector!.platform).toBe("feishu");
  });

  it("getRegisteredPlatforms includes feishu", () => {
    const platforms = getRegisteredPlatforms();
    expect(platforms).toContain("feishu");
  });

  it("unknown platform is not registered", () => {
    expect(isPlatformRegistered("telegram")).toBe(false);
  });
});
