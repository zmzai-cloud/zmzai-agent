import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { getProjectAccess } from "@/lib/project-access";
import { ProjectActivityModel } from "@/models/project-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { projectId } = await context.params;
  const access = await getProjectAccess(projectId, user.id);
  if (!access) return apiError("PROJECT_NOT_FOUND", 404, "项目不存在或无权访问");
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50));
  const activities = await ProjectActivityModel.find({ projectId }).sort({ createdAt: -1 }).limit(limit).lean();
  return NextResponse.json({ activities }, { headers: { "cache-control": "no-store" } });
}
