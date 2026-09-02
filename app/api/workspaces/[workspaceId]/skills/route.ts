import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getWorkspace, updateWorkspace } from "@/lib/workspaces";
import { reviewedGithubSkill } from "@/lib/github-skill-discovery";
import { addImportedGithubWorkspaceSkill, listWorkspaceSkills } from "@/lib/workspace-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importSchema = z.object({
  reviewToken: z.string().trim().min(20).max(8 * 1024),
  markdown: z.string().min(1).max(256 * 1024),
}).strict();

async function workspaceIdentity(context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return { error: unauthenticated() } as const;
  const { workspaceId } = await context.params;
  const workspace = await getWorkspace(user.id, workspaceId);
  if (!workspace) return { error: apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问") } as const;
  return { user, workspaceId, workspace } as const;
}

export async function GET(_: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const auth = await workspaceIdentity(context);
  if ("error" in auth) return auth.error;
  return NextResponse.json({ skills: await listWorkspaceSkills({ userId: auth.user.id, workspaceId: auth.workspaceId }) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const auth = await workspaceIdentity(context);
  if ("error" in auth) return auth.error;
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "请先预览 Skill，再导入固定版本");
  try {
    const imported = reviewedGithubSkill({ userId: auth.user.id, workspaceId: auth.workspaceId, ...parsed.data });
    const result = await addImportedGithubWorkspaceSkill({ userId: auth.user.id, workspaceId: auth.workspaceId, imported });
    if (!auth.workspace.skillIds.includes(result.skill.id)) {
      await updateWorkspace(auth.user.id, auth.workspaceId, { skillIds: [...auth.workspace.skillIds, result.skill.id] });
    }
    return NextResponse.json({ ...result, enabled: true }, { status: result.reused ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError("GITHUB_SKILL_IMPORT_FAILED", 422, error instanceof Error ? error.message : "GitHub Skill 导入失败");
  }
}
