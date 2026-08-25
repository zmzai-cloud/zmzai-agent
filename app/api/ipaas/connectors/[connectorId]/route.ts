import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { encryptConnectorHeaders } from "@/lib/connector-secrets";
import { getWorkspace } from "@/lib/workspaces";
import { IpaasConnectorModel } from "@/models/ipaas-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  credentials: z.record(z.string(), z.string().trim().min(1).max(500)).refine((obj) => Object.keys(obj).length >= 1, { message: "至少需要一个凭证字段" }).optional(),
  inboundEnabled: z.boolean().optional(),
  outboundEnabled: z.boolean().optional(),
  linkedAutomationId: z.string().trim().min(1).max(64).nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
}).strict();

export async function GET(_request: NextRequest, context: { params: Promise<{ connectorId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { connectorId } = await context.params;

  const connector = await IpaasConnectorModel.findOne({ connectorId }).lean();
  if (!connector) return apiError("CONNECTOR_NOT_FOUND", 404, "连接器不存在");

  const workspace = await getWorkspace(user.id, connector.workspaceId);
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  return NextResponse.json({
    connector: {
      connectorId: connector.connectorId, workspaceId: connector.workspaceId, platform: connector.platform,
      name: connector.name, inboundEnabled: connector.inboundEnabled, outboundEnabled: connector.outboundEnabled,
      inboundWebhookUrl: connector.inboundWebhookUrl ?? null, linkedAutomationId: connector.linkedAutomationId ?? null,
      status: connector.status, lastActivityAt: connector.lastActivityAt?.toISOString() ?? null,
      lastError: connector.lastError ?? null, createdAt: connector.createdAt.toISOString(),
    },
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ connectorId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { connectorId } = await context.params;

  const connector = await IpaasConnectorModel.findOne({ connectorId }).lean();
  if (!connector) return apiError("CONNECTOR_NOT_FOUND", 404, "连接器不存在");

  const workspace = await getWorkspace(user.id, connector.workspaceId);
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_BODY", 400, "请求体 JSON 格式无效"); }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return apiError("INVALID_BODY", 400, parsed.error.issues[0]?.message ?? "请求格式无效");

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.inboundEnabled !== undefined) updates.inboundEnabled = parsed.data.inboundEnabled;
  if (parsed.data.outboundEnabled !== undefined) updates.outboundEnabled = parsed.data.outboundEnabled;
  if (parsed.data.linkedAutomationId !== undefined) updates.linkedAutomationId = parsed.data.linkedAutomationId;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;

  if (parsed.data.credentials) {
    if (connector.platform === "feishu" && (!parsed.data.credentials.appId || !parsed.data.credentials.appSecret)) {
      return apiError("MISSING_CREDENTIALS", 400, "飞书连接器需要 appId 和 appSecret");
    }
    updates.encryptedCredentials = encryptConnectorHeaders(parsed.data.credentials);
  }

  const updated = await IpaasConnectorModel.findOneAndUpdate({ connectorId }, { $set: updates }, { new: true }).lean();

  return NextResponse.json({
    connector: {
      connectorId: updated!.connectorId, workspaceId: updated!.workspaceId, platform: updated!.platform,
      name: updated!.name, inboundEnabled: updated!.inboundEnabled, outboundEnabled: updated!.outboundEnabled,
      inboundWebhookUrl: updated!.inboundWebhookUrl ?? null, linkedAutomationId: updated!.linkedAutomationId ?? null,
      status: updated!.status, lastActivityAt: updated!.lastActivityAt?.toISOString() ?? null,
      lastError: updated!.lastError ?? null, createdAt: updated!.createdAt.toISOString(),
    },
  }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ connectorId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { connectorId } = await context.params;

  const connector = await IpaasConnectorModel.findOne({ connectorId }).lean();
  if (!connector) return apiError("CONNECTOR_NOT_FOUND", 404, "连接器不存在");

  const workspace = await getWorkspace(user.id, connector.workspaceId);
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  await IpaasConnectorModel.deleteOne({ connectorId });
  return NextResponse.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
}
