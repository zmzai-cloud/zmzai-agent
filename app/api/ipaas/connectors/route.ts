import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { encryptConnectorHeaders } from "@/lib/connector-secrets";
import { getWorkspace } from "@/lib/workspaces";
import { IPAAS_PLATFORMS } from "@/lib/ipaas/types";
import { isPlatformRegistered } from "@/lib/ipaas/connector-registry";
import { IpaasConnectorModel } from "@/models/ipaas-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  workspaceId: z.string().trim().min(1).max(64),
  platform: z.enum(IPAAS_PLATFORMS),
  name: z.string().trim().min(1).max(100),
  credentials: z.record(z.string(), z.string().trim().min(1).max(500)).refine((obj) => Object.keys(obj).length >= 1, { message: "至少需要一个凭证字段" }),
  inboundEnabled: z.boolean().optional().default(false),
  outboundEnabled: z.boolean().optional().default(false),
  linkedAutomationId: z.string().trim().min(1).max(64).nullable().optional(),
}).strict();

function summary(record: {
  connectorId: string; workspaceId: string; platform: string; name: string;
  inboundEnabled: boolean; outboundEnabled: boolean; linkedAutomationId?: string | null;
  status: string; lastActivityAt?: Date | null; lastError?: string | null; createdAt: Date;
}) {
  return {
    connectorId: record.connectorId, workspaceId: record.workspaceId, platform: record.platform,
    name: record.name, inboundEnabled: record.inboundEnabled, outboundEnabled: record.outboundEnabled,
    linkedAutomationId: record.linkedAutomationId ?? null, status: record.status,
    lastActivityAt: record.lastActivityAt?.toISOString() ?? null,
    lastError: record.lastError ?? null, createdAt: record.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) return apiError("MISSING_WORKSPACE_ID", 400, "需要 workspaceId 参数");

  const workspace = await getWorkspace(user.id, workspaceId);
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  const connectors = await IpaasConnectorModel.find({ workspaceId }).sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ connectors: connectors.map(summary) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();

  let body: unknown;
  try { body = await request.json(); } catch { return apiError("INVALID_BODY", 400, "请求体 JSON 格式无效"); }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiError("INVALID_BODY", 400, parsed.error.issues[0]?.message ?? "请求格式无效");

  const { workspaceId, platform, name, credentials, inboundEnabled, outboundEnabled, linkedAutomationId } = parsed.data;

  const workspace = await getWorkspace(user.id, workspaceId);
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  if (!isPlatformRegistered(platform)) return apiError("PLATFORM_NOT_SUPPORTED", 400, `平台 ${platform} 暂不支持`);

  if (platform === "feishu" && (!credentials.appId || !credentials.appSecret)) {
    return apiError("MISSING_CREDENTIALS", 400, "飞书连接器需要 appId 和 appSecret");
  }

  const encryptedCredentials = encryptConnectorHeaders(credentials);
  const connectorId = `ipc_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const inboundWebhookUrl = platform === "feishu" ? `/api/ipaas/feishu/inbound/${connectorId}` : null;

  const connector = await IpaasConnectorModel.create({
    connectorId, workspaceId, platform, name, encryptedCredentials,
    inboundEnabled, outboundEnabled, inboundWebhookUrl,
    linkedAutomationId: linkedAutomationId ?? null, status: "active",
  });

  return NextResponse.json({ connector: summary(connector), inboundWebhookUrl }, { status: 201, headers: { "cache-control": "no-store" } });
}
