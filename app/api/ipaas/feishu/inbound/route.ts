import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-error";
import { launchAutomation } from "@/lib/automation-execution";
import { decryptConnectorHeaders } from "@/lib/connector-secrets";
import { feishuConnector, feishuToInboundMessage, type FeishuChallenge, type FeishuInbound } from "@/lib/ipaas/feishu-adapter";
import { AutomationModel } from "@/models/automation";
import { IpaasConnectorModel } from "@/models/ipaas-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxBodyBytes = 64 * 1024;

export async function POST(request: Request, context: { params: Promise<{ connectorId: string }> }) {
  const { connectorId } = await context.params;
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
    return apiError("IPAAS_BODY_TOO_LARGE", 413, "飞书事件 body 不能超过 64 KiB");
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

  let credentials: Record<string, string>;
  try {
    credentials = decryptConnectorHeaders(connector.encryptedCredentials);
  } catch {
    return apiError("IPAAS_CREDENTIALS_INVALID", 500, "连接器凭证解密失败");
  }

  const result = feishuConnector.validateInbound({
    body,
    headers: Object.fromEntries(request.headers),
    connectorId,
    credentials,
  });

  if (!result) {
    return apiError("IPAAS_FEISHU_INVALID", 401, "飞书签名验证失败或事件格式无效");
  }

  if (result && typeof result === "object" && "challenge" in result) {
    const challenge = result as FeishuChallenge;
    return NextResponse.json({ challenge: challenge.challenge }, { headers: { "cache-control": "no-store" } });
  }

  const feishuInbound = result as FeishuInbound;

  await IpaasConnectorModel.updateOne(
    { connectorId },
    { $set: { lastActivityAt: new Date(), lastError: null } },
  );

  if (!connector.linkedAutomationId) {
    return NextResponse.json({
      received: true,
      message: "事件已接收，但未关联自动化",
      message_id: feishuInbound.messageId,
    }, { status: 202, headers: { "cache-control": "no-store" } });
  }

  const automation = await AutomationModel.findOne({
    automationId: connector.linkedAutomationId,
    workspaceId: connector.workspaceId,
    status: "active",
  }).lean();

  if (!automation) {
    return apiError("IPAAS_AUTOMATION_NOT_FOUND", 404, "关联的自动化不存在或已暂停");
  }

  const inboundMessage = feishuToInboundMessage(feishuInbound);
  const executionId = `aexec_${randomUUID().replaceAll("-", "").slice(0, 20)}`;

  const contextText = `[飞书消息]
message_id: ${inboundMessage.messageId}
actor: ${inboundMessage.actor}
channel: ${inboundMessage.channel}
chat_type: ${feishuInbound.chatType}

消息内容:
${inboundMessage.text}`;

  try {
    const launched = await launchAutomation({
      automation,
      source: "webhook",
      executionId,
      contextText,
    });

    return NextResponse.json({
      received: true,
      execution_id: executionId,
      task_id: launched.task.taskId,
      run_id: launched.run.runId,
    }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "飞书自动化启动失败";
    await IpaasConnectorModel.updateOne(
      { connectorId },
      { $set: { lastError: message } },
    );
    throw error;
  }
}
