import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { unauthenticated } from "@/lib/api-error";
import { WorkspaceModel } from "@/models/workspace";
import { WorkspaceSkillModel } from "@/models/workspace-skill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cross-workspace skill listing for the /skills management page. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const workspaces = await WorkspaceModel.find({ userId: user.id }).select({ workspaceId: 1, name: 1 }).lean();
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.name]));
  const targetIds = workspaceId ? [workspaceId] : [...workspaceNames.keys()];
  const skills = targetIds.length
    ? await WorkspaceSkillModel.find({ userId: user.id, workspaceId: { $in: targetIds } }).sort({ createdAt: -1 }).limit(200).lean()
    : [];
  return NextResponse.json({
    skills: skills.map((skill) => ({
      id: skill.skillId,
      name: skill.name,
      description: skill.description,
      repository: skill.repository,
      requestedRef: skill.requestedRef,
      commitSha: skill.commitSha,
      path: skill.path,
      workspaceId: skill.workspaceId,
      workspaceName: workspaceNames.get(skill.workspaceId) ?? skill.workspaceId,
      source: skill.repository === "zmzai/task" ? "task" : "github",
      markdown: skill.markdown,
      createdAt: skill.createdAt.toISOString(),
    })),
  }, { headers: { "cache-control": "no-store" } });
}
