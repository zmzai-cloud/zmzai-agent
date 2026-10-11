import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { FrameworkSessionModel } from "@/framework/core/session/mongo-models";
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
  const stable = request.nextUrl.searchParams.get("order") === "stable";
  const after = request.nextUrl.searchParams.get("after");
  const rawCursor = request.nextUrl.searchParams.get("cursor");
  let cursor: { updated: string; sessionId: string } | undefined;
  if (rawCursor !== null) {
    try {
      if (stable || after || rawCursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error("cursor");
      cursor = z.object({ updated: z.string().datetime(), sessionId: z.string().min(1).max(80) }).strict().parse(JSON.parse(Buffer.from(rawCursor, "base64url").toString()));
    } catch { return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400 }); }
  }
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if ((after !== null && (!stable || !after || after.length > 80)) || q.length > 120) {
    return NextResponse.json({ error: "INVALID_CURSOR_OR_QUERY" }, { status: 400 });
  }
  await connectMongo();
  const workspaces = await WorkspaceModel.find({ userId }).select({ workspaceId: 1, name: 1 }).lean();
  const query = { userId, workspaceId: { $in: workspaces.map((workspace) => workspace.workspaceId) },
    ...(after ? { sessionId: { $gt: after } } : {}),
    ...(cursor ? { $or: [{ "time.updated": { $lt: cursor.updated } }, { "time.updated": cursor.updated, sessionId: { $lt: cursor.sessionId } }] } : {}),
    ...(q ? { title: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {}),
  };
  const records = await FrameworkSessionModel.find(query)
    .sort(stable ? { sessionId: 1 } : { "time.updated": -1, sessionId: -1 }).limit(limit + 1).lean();
  const sessions = records.slice(0, limit);
  const last = sessions.at(-1);
  const nextCursor = records.length > limit && last
    ? stable ? last.sessionId : Buffer.from(JSON.stringify({ updated: last.time?.updated ?? new Date(0).toISOString(), sessionId: last.sessionId })).toString("base64url")
    : null;
  const runs = await RunModel.find({ userId, sessionId: { $in: sessions.map((session) => session.sessionId) } })
    .select({ runId: 1, sessionId: 1, status: 1, active: 1, createdAt: 1 }).lean();
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.name]));
  const latestRunBySession = new Map<string, { runId: string; status: string; active: boolean }>();
  for (const run of [...runs].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())) {
    latestRunBySession.set(run.sessionId, { runId: run.runId, status: run.status, active: run.active === true });
  }

  const items = [];
  for (const session of sessions) {
    items.push({
      sessionId: session.sessionId,
      title: session.title || "未命名对话",
      workspaceId: session.workspaceId,
      workspaceName: workspaceNames.get(session.workspaceId) ?? null,
      updatedAt: session.time?.updated ? new Date(session.time.updated).toISOString() : null,
      latestRun: latestRunBySession.get(session.sessionId) ?? null,
    });
  }
  return NextResponse.json({ items, nextCursor }, { headers: { "cache-control": "no-store" } });
}
