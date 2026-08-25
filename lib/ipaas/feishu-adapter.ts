/**
 * 飞书连接器适配器
 *
 * 处理飞书事件订阅的签名验证、消息标准化，以及通过飞书 Bot API 发送消息。
 */

import { createHmac, createDecipheriv, createHash } from "node:crypto";

import type { Connector, ConnectorConfig, DeliveryResult, InboundMessage, InboundRequest, OutboundMessage } from "./types";

/** 飞书凭证字段 */
export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
}

/** 飞书入站消息 */
export type FeishuInbound = {
  messageId: string;
  actor: string;
  channel: string;
  text: string;
  chatType: "p2p" | "group";
  replyContext: { receiveId: string; receiveIdType: string };
};

/** 飞书 URL 验证挑战 */
export type FeishuChallenge = { challenge: string };

/** tenant_access_token 缓存 */
let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * 解析飞书事件请求
 */
export function parseFeishuEvent(body: string, encryptKey?: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    if (data.encrypt && encryptKey) {
      return decryptFeishuEvent(String(data.encrypt), encryptKey);
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * 解密飞书加密事件
 */
function decryptFeishuEvent(encrypted: string, encryptKey: string): Record<string, unknown> | null {
  try {
    const key = createHash("sha256").update(encryptKey, "utf8").digest();
    const encryptedBuffer = Buffer.from(encrypted, "base64");
    const iv = encryptedBuffer.subarray(0, 16);
    const data = encryptedBuffer.subarray(16);
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 验证飞书 verification_token
 */
export function verifyFeishuToken(event: Record<string, unknown>, verificationToken: string): boolean {
  const token = event.token ?? event.verification_token;
  return typeof token === "string" && token === verificationToken;
}

/**
 * 解析飞书事件为标准化消息或挑战
 */
export function normalizeFeishuEvent(event: Record<string, unknown>): FeishuChallenge | FeishuInbound | null {
  if (event.type === "url_verification" && typeof event.challenge === "string") {
    return { challenge: event.challenge };
  }

  if (event.type !== "event_callback" && event.type !== "im.message.receive_v1") {
    return null;
  }

  const innerEvent = event.event as Record<string, unknown> | undefined;
  if (!innerEvent) return null;

  const message = innerEvent.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const messageId = typeof message.message_id === "string" ? message.message_id : "";
  const chatId = typeof message.chat_id === "string" ? message.chat_id : "";
  const chatType = message.chat_type === "p2p" ? "p2p" : "group";
  const sender = innerEvent.sender as Record<string, unknown> | undefined;
  const senderId = sender?.sender_id as Record<string, unknown> | undefined;
  const actor = typeof senderId?.open_id === "string" ? senderId.open_id : typeof senderId?.user_id === "string" ? senderId.user_id : "unknown";

  const contentStr = typeof message.content === "string" ? message.content : "";
  let text = "";
  try {
    const content = JSON.parse(contentStr) as Record<string, unknown>;
    text = typeof content.text === "string" ? content.text.trim() : "";
  } catch {
    text = contentStr.trim();
  }

  if (!messageId || !chatId || !text) return null;

  return {
    messageId,
    actor,
    channel: chatId,
    text,
    chatType,
    replyContext: { receiveId: chatId, receiveIdType: "chat_id" },
  };
}

/**
 * 获取飞书 tenant_access_token（带缓存）
 */
export async function getFeishuTenantToken(appId: string, appSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`飞书 token 请求失败: ${response.status}`);
  }

  const data = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书 token 获取失败: ${data.msg ?? "未知错误"}`);
  }

  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire ?? 7200) * 1000 - 60_000,
  };

  return data.tenant_access_token;
}

/**
 * 通过飞书 Bot API 发送消息
 */
export async function sendFeishuMessage(
  credentials: FeishuCredentials,
  receiveId: string,
  receiveIdType: "chat_id" | "open_id" | "user_id",
  content: { text?: string; richContent?: unknown },
): Promise<DeliveryResult> {
  try {
    const token = await getFeishuTenantToken(credentials.appId, credentials.appSecret);

    let msgType: string;
    let msgContent: string;
    if (content.richContent) {
      msgType = "interactive";
      msgContent = JSON.stringify(content.richContent);
    } else {
      msgType = "text";
      msgContent = JSON.stringify({ text: content.text ?? "" });
    }

    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "ZMZAI-Agent-Feishu/1.0",
      },
      body: JSON.stringify({ receive_id: receiveId, msg_type: msgType, content: msgContent }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`飞书 API 返回 ${response.status}`);
    }

    const data = await response.json() as { code?: number; msg?: string; data?: { message_id?: string } };
    if (data.code !== 0) {
      throw new Error(`飞书发送失败: ${data.msg ?? "未知错误"}`);
    }

    return { success: true, messageId: data.data?.message_id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "飞书发送异常" };
  }
}

/**
 * 飞书连接器实现
 */
export const feishuConnector: Connector = {
  platform: "feishu",

  validateInbound(request: InboundRequest): FeishuChallenge | FeishuInbound | null {
    const credentials = request.credentials as unknown as FeishuCredentials;
    const event = parseFeishuEvent(request.body, credentials.encryptKey);
    if (!event) return null;

    if (credentials.verificationToken && !verifyFeishuToken(event, credentials.verificationToken)) {
      return null;
    }

    return normalizeFeishuEvent(event);
  },

  async sendOutbound(config: ConnectorConfig, message: OutboundMessage): Promise<DeliveryResult> {
    const credentials = config.credentials as unknown as FeishuCredentials;
    const receiveIdType = message.to.startsWith("ou_") ? "open_id" : "chat_id";
    return sendFeishuMessage(credentials, message.to, receiveIdType, {
      text: message.text,
      richContent: message.richContent,
    });
  },
};

/**
 * 将飞书入站消息转换为标准化 InboundMessage
 */
export function feishuToInboundMessage(feishu: FeishuInbound): InboundMessage {
  return {
    platform: "feishu",
    messageId: feishu.messageId,
    actor: feishu.actor,
    channel: feishu.channel,
    text: feishu.text,
    replyContext: feishu.replyContext,
  };
}

/**
 * 清除 token 缓存（测试用）
 */
export function clearFeishuTokenCache(): void {
  tokenCache = null;
}
