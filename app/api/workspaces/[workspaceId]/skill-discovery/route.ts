import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { listTrustedSkills } from "@/lib/github-skill-discovery";
import { getWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await getWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.length > 128) return apiError("INVALID_QUERY", 400, "搜索关键词过长");
  return NextResponse.json({ skills: listTrustedSkills(query) }, { headers: { "cache-control": "no-store" } });
}
