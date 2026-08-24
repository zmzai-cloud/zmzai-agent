import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getWorkspace } from "@/lib/workspaces";
import { ConnectorAuditLogModel } from "@/models/connector-audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string; connectorId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId, connectorId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "50"), 200);
  const logs = await ConnectorAuditLogModel.find({ workspaceId, connectorId }).sort({ createdAt: -1 }).limit(limit).lean();
  return NextResponse.json({
    logs: logs.map((log) => ({
      logId: log.logId,
      connectorId: log.connectorId,
      userId: log.userId,
      kind: log.kind,
      detail: log.detail,
      createdAt: log.createdAt.toISOString(),
    })),
  }, { headers: { "cache-control": "no-store" } });
}
