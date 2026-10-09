import { NextRequest, NextResponse } from "next/server";

import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { defaultStore } from "@/framework/core/runtime/runner";
import { RunModel } from "@/models/run";
import { WorkspaceModel } from "@/models/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WorkOS 首页「继续上次」与会话列表：返回用户最近会话 + 最新 Run 状态。
 *  与 sessions/[sessionId] 相同的 owner 校验口径（userId + workspace 属主）。 */
export async function GET(request: NextRequest) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!isWorkosUserId(userId)) return NextResponse.json({ error: "INVALID_USER_ID" }, { status: 400 });
  const rawLimit = request.nextUrl.searchParams.get("limit") ?? "20";
  if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1) return NextResponse.json({ error: "INVALID_LIMIT" }, { status: 400 });
  const limit = Math.min(Number(rawLimit), 100);
  await connectMongo();

  const sessions = (await defaultStore.listSessions({ userId })).slice(0, limit);
  const workspaceIds = [...new Set(sessions.map((session) => session.workspaceId))];
  const [workspaces, runs] = await Promise.all([
    WorkspaceModel.find({ userId, workspaceId: { $in: workspaceIds } }).select({ workspaceId: 1, name: 1 }).lean(),
    RunModel.find({ userId, sessionId: { $in: sessions.map((session) => session.id) } }).select({ runId: 1, sessionId: 1, status: 1, active: 1, createdAt: 1 }).lean(),
  ]);
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.name]));
  const latestRunBySession = new Map<string, { runId: string; status: string; active: boolean }>();
  for (const run of [...runs].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())) {
    latestRunBySession.set(run.sessionId, { runId: run.runId, status: run.status, active: run.active === true });
  }

  const items = [];
  for (const session of sessions) {
    const owned = await getOwnedWorkosSession(session.id, userId);
    if (!owned) continue;
    items.push({
      sessionId: session.id,
      title: session.title || "未命名对话",
      workspaceId: session.workspaceId,
      workspaceName: workspaceNames.get(session.workspaceId) ?? null,
      updatedAt: session.time?.updated ? new Date(session.time.updated).toISOString() : null,
      latestRun: latestRunBySession.get(session.id) ?? null,
    });
  }
  return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
}
