/**
 * 邮件连接器
 *
 * 入站：复用现有 email-adapter.ts 的签名验证和消息标准化
 * 出站：通过配置的邮件 API 发送（支持 SMTP relay 或 HTTP API）
 */

import type { Connector, ConnectorConfig, DeliveryResult, InboundMessage, InboundRequest, OutboundMessage } from "./types";
import { normalizeEmailRequest, type EmailInbound } from "@/lib/email-adapter";

/** 邮件凭证字段 */
export interface EmailCredentials {
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
  // 或者使用 HTTP API
  apiUrl?: string;
  apiKey?: string;
}

/**
 * 邮件连接器实现
 */
export const emailConnector: Connector = {
  platform: "email",

  validateInbound(request: InboundRequest): EmailInbound | null {
    // 复用现有的邮件消息标准化逻辑
    return normalizeEmailRequest(request.body);
  },

  async sendOutbound(config: ConnectorConfig, message: OutboundMessage): Promise<DeliveryResult> {
    const credentials = config.credentials as unknown as EmailCredentials;

    // 如果配置了 HTTP API（如 SendGrid, Mailgun 等）
    if (credentials.apiUrl && credentials.apiKey) {
      return sendEmailViaApi(credentials, message);
    }

    // 如果配置了 SMTP（需要外部服务中转，因为 Node.js 无内置 SMTP）
    if (credentials.smtpHost && credentials.smtpUser && credentials.smtpPass) {
      return sendEmailViaSmtpRelay(credentials, message);
    }

    return { success: false, error: "邮件连接器未配置发送方式（需要 apiUrl+apiKey 或 SMTP 配置）" };
  },
};

/**
 * 通过 HTTP API 发送邮件
 */
async function sendEmailViaApi(credentials: EmailCredentials, message: OutboundMessage): Promise<DeliveryResult> {
  try {
    const response = await fetch(credentials.apiUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.apiKey}`,
        "user-agent": "ZMZAI-Agent-Email/1.0",
      },
      body: JSON.stringify({
        from: credentials.fromEmail ?? "noreply@zmzai.cloud",
        to: message.to,
        subject: message.text.slice(0, 100),
        text: message.text,
        html: message.richContent ? String(message.richContent) : undefined,
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`邮件 API 返回 ${response.status}`);
    }

    const data = await response.json() as { messageId?: string };
    return { success: true, messageId: data.messageId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "邮件发送异常" };
  }
}

/**
 * 通过 SMTP 中继服务发送（需要外部 SMTP 网关）
 * 这里通过 HTTP 调用 SMTP 网关实现
 */
async function sendEmailViaSmtpRelay(credentials: EmailCredentials, message: OutboundMessage): Promise<DeliveryResult> {
  // 实际项目中，这里应该调用一个 SMTP 网关服务
  // 例如：自建 SMTP proxy，或使用第三方 SMTP relay API
  try {
    // 示例：调用内部 SMTP 网关
    const response = await fetch("http://localhost:3001/api/send-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host: credentials.smtpHost,
        port: Number(credentials.smtpPort ?? 587),
        user: credentials.smtpUser,
        pass: credentials.smtpPass,
        from: credentials.fromEmail ?? credentials.smtpUser,
        to: message.to,
        subject: message.text.slice(0, 100),
        text: message.text,
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`SMTP 网关返回 ${response.status}`);
    }

    const data = await response.json() as { messageId?: string };
    return { success: true, messageId: data.messageId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "SMTP 发送异常" };
  }
}

/**
 * 将邮件入站消息转换为标准化 InboundMessage
 */
export function emailToInboundMessage(email: EmailInbound): InboundMessage {
  return {
    platform: "email",
    messageId: email.messageId,
    actor: email.from,
    channel: email.to,
    text: `[邮件] 主题: ${email.subject}\n\n${email.text}`,
    replyContext: {
      inReplyTo: email.messageId,
      references: email.references,
    },
  };
}
