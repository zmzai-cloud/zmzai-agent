import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getWorkspace } from "@/lib/workspaces";
import { WorkspaceSkillModel } from "@/models/workspace-skill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, context: { params: Promise<{ workspaceId: string; skillId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId, skillId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const skill = await WorkspaceSkillModel.findOne({ skillId, workspaceId, userId: user.id }).lean();
  if (!skill) return apiError("SKILL_NOT_FOUND", 404, "Skill 不存在或无权访问");
  return NextResponse.json({ skill: { id: skill.skillId, name: skill.name, description: skill.description, repository: skill.repository, requestedRef: skill.requestedRef, commitSha: skill.commitSha, path: skill.path, markdown: skill.markdown, createdAt: skill.createdAt.toISOString() } }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ workspaceId: string; skillId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId, skillId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const deleted = await WorkspaceSkillModel.deleteOne({ skillId, workspaceId, userId: user.id });
  if (!deleted.deletedCount) return apiError("SKILL_NOT_FOUND", 404, "Skill 不存在或无权访问");
  return NextResponse.json({ deleted: true }, { headers: { "cache-control": "no-store" } });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(2_000).optional(),
  markdown: z.string().trim().min(1).max(256 * 1024).optional(),
}).strict();

/** Only task-sourced skills (repository === "zmzai/task") are editable.
 *  GitHub skills are immutable — use the refresh endpoint instead. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string; skillId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId, skillId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const skill = await WorkspaceSkillModel.findOne({ skillId, workspaceId, userId: user.id }).lean();
  if (!skill) return apiError("SKILL_NOT_FOUND", 404, "Skill 不存在或无权访问");
  if (skill.repository !== "zmzai/task") return apiError("SKILL_IMMUTABLE", 409, "GitHub 导入的 Skill 不可编辑，请使用刷新功能");
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "更新格式不正确");
  const update: Record<string, string> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.markdown !== undefined) {
    update.markdown = parsed.data.markdown;
    update.commitSha = createHash("sha256").update(parsed.data.markdown).digest("hex").slice(0, 40);
  }
  if (!Object.keys(update).length) return NextResponse.json({ skill: { id: skill.skillId, name: skill.name, description: skill.description, markdown: skill.markdown, commitSha: skill.commitSha, createdAt: skill.createdAt.toISOString() } });
  const updated = await WorkspaceSkillModel.findOneAndUpdate(
    { skillId, workspaceId, userId: user.id },
    { $set: update },
    { new: true },
  ).lean();
  if (!updated) return apiError("SKILL_NOT_FOUND", 404, "Skill 不存在或无权访问");
  return NextResponse.json({ skill: { id: updated.skillId, name: updated.name, description: updated.description, markdown: updated.markdown, commitSha: updated.commitSha, createdAt: updated.createdAt.toISOString() } }, { headers: { "cache-control": "no-store" } });
}
