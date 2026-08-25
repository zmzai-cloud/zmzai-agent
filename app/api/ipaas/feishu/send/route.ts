import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-error";
import { requireAgentApiKey } from "@/lib/public-api";
import { decryptConnectorHeaders } from "@/lib/connector-secrets";
import { sendFeishuMessage } from "@/lib/ipaas/feishu-adapter";
import { IpaasConnectorModel } from "@/models/ipaas-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorized = await requireAgentApiKey(request, "chat:write");
  if ("response" in authorized) return authorized.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("IPAAS_INVALID_BODY", 400, "请求体 JSON 格式无效");
  }

  const connectorId = typeof (body as Record<string, unknown>).connectorId === "string"
    ? (body as Record<string, string>).connectorId
    : "";
  const receiveId = typeof (body as Record<string, unknown>).receiveId === "string"
    ? (body as Record<string, string>).receiveId
    : "";
  const text = typeof (body as Record<string, unknown>).text === "string"
    ? (body as Record<string, string>).text
    : "";
  const richContent = (body as Record<string, unknown>).richContent;

  if (!connectorId || !receiveId || (!text && !richContent)) {
    return apiError("IPAAS_MISSING_FIELDS", 400, "缺少必填字段: connectorId, receiveId, text 或 richContent");
  }

  const connector = await IpaasConnectorModel.findOne({ connectorId, platform: "feishu" })
    .select("+encryptedCredentials")
    .lean();

  if (!connector) {
    return apiError("IPAAS_CONNECTOR_NOT_FOUND", 404, "飞书连接器不存在");
  }
  if (connector.status !== "active") {
    return apiError("IPAAS_CONNECTOR_PAUSED", 403, "飞书连接器已暂停");
  }
  if (!connector.outboundEnabled) {
    return apiError("IPAAS_OUTBOUND_DISABLED", 403, "该连接器的出站功能未启用");
  }

  let credentials: Record<string, string>;
  try {
    credentials = decryptConnectorHeaders(connector.encryptedCredentials);
  } catch {
    return apiError("IPAAS_CREDENTIALS_INVALID", 500, "连接器凭证解密失败");
  }

  const receiveIdType = receiveId.startsWith("ou_") ? "open_id" : "chat_id";

  const result = await sendFeishuMessage(
    { appId: credentials.appId, appSecret: credentials.appSecret },
    receiveId,
    receiveIdType,
    { text, richContent },
  );

  await IpaasConnectorModel.updateOne(
    { connectorId },
    { $set: { lastActivityAt: new Date(), lastError: result.success ? null : result.error ?? null } },
  );

  if (!result.success) {
    return apiError("IPAAS_SEND_FAILED", 502, result.error ?? "飞书消息发送失败");
  }

  return NextResponse.json({
    sent: true,
    message_id: result.messageId ?? null,
    connector_id: connectorId,
  }, { status: 201, headers: { "cache-control": "no-store" } });
}
