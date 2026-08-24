import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getProjectAccess } from "@/lib/project-access";
import { workspaceOwnsConnectorIds } from "@/lib/workspace-connectors";
import { ProjectModel } from "@/models/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { projectId } = await context.params;
  const access = await getProjectAccess(projectId, user.id);
  if (!access) return apiError("PROJECT_NOT_FOUND", 404, "项目不存在或无权访问");
  const project = await ProjectModel.findOne({ projectId }).lean();
  if (!project) return apiError("PROJECT_NOT_FOUND", 404, "项目不存在");
  return NextResponse.json({ connectorIds: project.connectorIds ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { projectId } = await context.params;
  const access = await getProjectAccess(projectId, user.id);
  if (!access) return apiError("PROJECT_NOT_FOUND", 404, "项目不存在或无权访问");
  if (access.role !== "owner" && access.role !== "editor") return apiError("FORBIDDEN", 403, "当前角色不能修改项目连接器");
  const body = await request.json().catch(() => null) as { connectorIds?: string[] } | null;
  const connectorIds = body?.connectorIds ?? [];
  if (!Array.isArray(connectorIds)) return apiError("INVALID_BODY", 400, "connectorIds 必须是字符串数组");
  if (connectorIds.length && !(await workspaceOwnsConnectorIds({ userId: user.id, workspaceId: (await ProjectModel.findOne({ projectId }).lean())?.workspaceId ?? "", connectorIds }))) return apiError("INVALID_CONNECTOR", 400, "部分连接器不属于当前 Workspace");
  const project = await ProjectModel.findOneAndUpdate({ projectId }, { $set: { connectorIds } }, { new: true }).lean();
  return NextResponse.json({ connectorIds: project?.connectorIds ?? [] }, { headers: { "cache-control": "no-store" } });
}
