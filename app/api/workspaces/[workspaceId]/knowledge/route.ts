import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getWorkspace } from "@/lib/workspaces";
import { WorkspaceModel } from "@/models/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/workspaces/:workspaceId/knowledge — list knowledge entries. */
export async function GET(_: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const workspace = await WorkspaceModel.findOne({ workspaceId, userId: user.id }).select({ knowledgeBase: 1 }).lean();
  return NextResponse.json({ knowledgeBase: workspace?.knowledgeBase ?? [] }, { headers: { "cache-control": "no-store" } });
}

const entrySchema = z.object({
  title: z.string().trim().min(1).max(128),
  content: z.string().trim().min(1).max(16 * 1024),
}).strict();

const updateSchema = z.object({
  entryId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(128).optional(),
  content: z.string().trim().min(1).max(16 * 1024).optional(),
}).strict();

/** POST /api/workspaces/:workspaceId/knowledge — add a knowledge entry. */
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "知识条目格式不正确");
  const entryId = `kb_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const entry = { entryId, title: parsed.data.title, content: parsed.data.content };
  await WorkspaceModel.updateOne({ workspaceId, userId: user.id }, { $push: { knowledgeBase: entry } });
  return NextResponse.json({ entry }, { status: 201, headers: { "cache-control": "no-store" } });
}

/** PUT /api/workspaces/:workspaceId/knowledge — update a knowledge entry by entryId. */
export async function PUT(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "更新格式不正确");
  const workspace = await WorkspaceModel.findOne({ workspaceId, userId: user.id }).select({ knowledgeBase: 1 }).lean();
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在");
  const idx = workspace.knowledgeBase.findIndex((entry) => entry.entryId === parsed.data.entryId);
  if (idx === -1) return apiError("ENTRY_NOT_FOUND", 404, "知识条目不存在");
  if (parsed.data.title !== undefined) workspace.knowledgeBase[idx]!.title = parsed.data.title;
  if (parsed.data.content !== undefined) workspace.knowledgeBase[idx]!.content = parsed.data.content;
  await WorkspaceModel.updateOne({ workspaceId, userId: user.id }, { $set: { knowledgeBase: workspace.knowledgeBase } });
  return NextResponse.json({ entry: workspace.knowledgeBase[idx] }, { headers: { "cache-control": "no-store" } });
}

/** DELETE /api/workspaces/:workspaceId/knowledge?entryId=xxx — remove a knowledge entry. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const entryId = request.nextUrl.searchParams.get("entryId")?.trim();
  if (!entryId) return apiError("ENTRY_ID_REQUIRED", 400, "缺少 entryId 参数");
  await WorkspaceModel.updateOne({ workspaceId, userId: user.id }, { $pull: { knowledgeBase: { entryId } } });
  return NextResponse.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
}
