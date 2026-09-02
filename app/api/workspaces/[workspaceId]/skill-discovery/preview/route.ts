import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { previewGithubSkill } from "@/lib/github-skill-discovery";
import { getWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({
  repository: z.string().trim().min(3).max(256),
  ref: z.string().trim().min(1).max(256).default("main"),
  path: z.string().trim().min(1).max(512),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const parsed = previewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "GitHub Skill 请求格式不正确");
  try {
    const preview = await previewGithubSkill({ userId: user.id, workspaceId, ...parsed.data });
    return NextResponse.json(preview, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError("GITHUB_SKILL_PREVIEW_FAILED", 422, error instanceof Error ? error.message : "GitHub Skill 预览失败");
  }
}
