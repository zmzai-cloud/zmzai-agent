import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-error";
import { launchAutomation } from "@/lib/automation-execution";
import { decryptConnectorHeaders } from "@/lib/connector-secrets";
import { webhookConnector, webhookToInboundMessage, type WebhookInbound } from "@/lib/ipaas/webhook-connector";
import { AutomationModel } from "@/models/automation";
import { IpaasConnectorModel } from "@/models/ipaas-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBodyBytes = 256 * 1024;

export async function POST(request: Request, context: { params: Promise<{ connectorId: string }> }) {
  const { connectorId } = await context.params;
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) return apiError("IPAAS_BODY_TOO_LARGE", 413, "Webhook body 不能超过 256 KiB");

  const connector = await IpaasConnectorModel.findOne({ connectorId, platform: "webhook" }).select("+encryptedCredentials").lean();
  if (!connector) return apiError("IPAAS_CONNECTOR_NOT_FOUND", 404, "Webhook 连接器不存在");
  if (connector.status !== "active") return apiError("IPAAS_CONNECTOR_PAUSED", 403, "Webhook 连接器已暂停");

  let credentials: Record<string, string>;
  try { credentials = decryptConnectorHeaders(connector.encryptedCredentials); } catch { return apiError("IPAAS_CREDENTIALS_INVALID", 500, "连接器凭证解密失败"); }

  const result = webhookConnector.validateInbound({
    body, headers: Object.fromEntries(request.headers), connectorId, credentials,
  });

  if (!result) return apiError("IPAAS_WEBHOOK_INVALID", 401, "Webhook 签名验证失败或格式无效");

  const webhookInbound = result as WebhookInbound;

  await IpaasConnectorModel.updateOne({ connectorId }, { $set: { lastActivityAt: new Date(), lastError: null } });

  if (!connector.linkedAutomationId) {
    return NextResponse.json({ received: true, message: "Webhook 已接收，但未关联自动化", message_id: webhookInbound.messageId }, { status: 202, headers: { "cache-control": "no-store" } });
  }

  const automation = await AutomationModel.findOne({ automationId: connector.linkedAutomationId, workspaceId: connector.workspaceId, status: "active" }).lean();
  if (!automation) return apiError("IPAAS_AUTOMATION_NOT_FOUND", 404, "关联的自动化不存在或已暂停");

  const inboundMessage = webhookToInboundMessage(webhookInbound);
  const executionId = `aexec_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const contextText = `[Webhook 事件]\nconnector: ${connector.name}\nevent: ${webhookInbound.event}\nsource: ${webhookInbound.source}\n\n${inboundMessage.text}`;

  try {
    const launched = await launchAutomation({ automation, source: "webhook", executionId, contextText });
    return NextResponse.json({ received: true, execution_id: executionId, task_id: launched.task.taskId, run_id: launched.run.runId }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "Webhook 自动化启动失败";
    await IpaasConnectorModel.updateOne({ connectorId }, { $set: { lastError: message } });
    throw error;
  }
}
