/**
 * Webhook 连接器
 *
 * 入站：接收通用 HTTP webhook，支持自定义签名验证
 * 出站：复用现有 outbound-webhooks.ts 的投递管道，增加更多 payload 格式
 */

import { createHmac } from "node:crypto";

import type { Connector, ConnectorConfig, DeliveryResult, InboundMessage, InboundRequest, OutboundMessage } from "./types";

/** Webhook 凭证字段 */
export interface WebhookCredentials {
  secret?: string; // 用于签名验证的密钥
}

/** Webhook 入站消息 */
export type WebhookInbound = {
  messageId: string;
  source: string;
  event: string;
  payload: unknown;
};

/**
 * 验证 Webhook 签名
 */
export function verifyWebhookSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `v1=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  return signature === expected;
}

/**
 * 解析 Webhook 入站请求
 */
export function parseWebhookInbound(body: string, headers: Record<string, string | string[] | undefined>): WebhookInbound | null {
  let payload: unknown;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = { raw: body };
  }

  // 从 headers 或 payload 中提取元数据
  const messageId = String(headers["x-webhook-id"] ?? headers["x-request-id"] ?? `wh_${Date.now()}`);
  const source = String(headers["x-webhook-source"] ?? headers["user-agent"] ?? "unknown");
  const event = String(headers["x-webhook-event"] ?? (payload && typeof payload === "object" && "event" in payload ? String((payload as Record<string, unknown>).event) : "webhook"));

  return { messageId, source, event, payload };
}

/**
 * Webhook 连接器实现
 */
export const webhookConnector: Connector = {
  platform: "webhook",

  validateInbound(request: InboundRequest): WebhookInbound | null {
    const credentials = request.credentials as unknown as WebhookCredentials;

    // 如果配置了 secret，验证签名
    if (credentials.secret) {
      const signature = String(request.headers["x-webhook-signature"] ?? "");
      if (!verifyWebhookSignature(request.body, signature, credentials.secret)) {
        return null;
      }
    }

    return parseWebhookInbound(request.body, request.headers);
  },

  async sendOutbound(config: ConnectorConfig, message: OutboundMessage): Promise<DeliveryResult> {
    const credentials = config.credentials as unknown as WebhookCredentials;

    // message.to 是目标 URL
    const targetUrl = message.to;
    if (!targetUrl || !targetUrl.startsWith("http")) {
      return { success: false, error: "Webhook 目标必须是有效 URL" };
    }

    try {
      // 构建 payload
      const payload = message.richContent ?? { text: message.text, timestamp: new Date().toISOString() };
      const body = JSON.stringify(payload);

      // 计算签名
      const signature = credentials.secret
        ? `v1=${createHmac("sha256", credentials.secret).update(body, "utf8").digest("hex")}`
        : undefined;

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "ZMZAI-Agent-Webhook/1.0",
          ...(signature ? { "x-webhook-signature": signature } : {}),
          "x-webhook-timestamp": new Date().toISOString(),
        },
        body,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Webhook 目标返回 ${response.status}`);
      }

      return { success: true, messageId: `wh_${Date.now()}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Webhook 发送异常" };
    }
  },
};

/**
 * 将 Webhook 入站消息转换为标准化 InboundMessage
 */
export function webhookToInboundMessage(webhook: WebhookInbound): InboundMessage {
  const text = typeof webhook.payload === "string"
    ? webhook.payload
    : `[Webhook: ${webhook.event}]\n来源: ${webhook.source}\n\n${JSON.stringify(webhook.payload, null, 2).slice(0, 4000)}`;

  return {
    platform: "webhook",
    messageId: webhook.messageId,
    actor: webhook.source,
    channel: webhook.event,
    text,
    replyContext: webhook.payload,
  };
}
