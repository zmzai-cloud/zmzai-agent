import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { refreshGithubSkill } from "@/lib/workspace-skills";
import { getWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/workspaces/:workspaceId/skills/:skillId/refresh
 *  Refresh a GitHub-sourced skill to the latest version. */
export async function POST(_: NextRequest, context: { params: Promise<{ workspaceId: string; skillId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId, skillId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  try {
    const result = await refreshGithubSkill({ userId: user.id, workspaceId, skillId });
    if (!result.skill && !result.updated && !result.newSha) return apiError("SKILL_NOT_FOUND", 404, "Skill 不存在或不是 GitHub 来源");
    if (!result.updated) return NextResponse.json({ updated: false, currentSha: result.newSha || result.oldSha }, { headers: { "cache-control": "no-store" } });
    return NextResponse.json({ updated: true, oldSha: result.oldSha, newSha: result.newSha, skill: result.skill }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("GitHub")) return apiError("REFRESH_FAILED", 422, error.message);
    throw error;
  }
}
