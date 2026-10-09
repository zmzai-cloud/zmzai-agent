import { NextRequest, NextResponse } from "next/server";
import { defaultStore } from "@/framework/core/runtime/runner";
import { connectMongo } from "@/lib/database/mongodb";
import { readMemoryRunState, settleStaleRetention } from "@/lib/memory/run-state";
import { isMemoryConfigured } from "@/lib/memory/provider";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { RunModel } from "@/models/run";
import { WorkspaceModel } from "@/models/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!isWorkosUserId(userId)) return NextResponse.json({ error: "INVALID_USER_ID" }, { status: 400 });
  await connectMongo();
  const { sessionId } = await context.params;
  const session = await getOwnedWorkosSession(sessionId, userId);
  if (!session) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  const workspace = await WorkspaceModel.findOne({ workspaceId: session.workspaceId, userId }).lean();
  if (!workspace) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  const latestRun = await RunModel.findOne({ sessionId, workspaceId: session.workspaceId, userId }).sort({ createdAt: -1, runId: -1 }).lean();
  let memory = latestRun ? await readMemoryRunState(latestRun.runId) : null;
  if (memory && (memory.retention.status === "pending" || memory.retention.status === "not_started")) {
    memory = await settleStaleRetention(memory.runId, new Date(), latestRun?.active === false ? latestRun.finishedAt ?? null : null);
  }
  const messages = (await defaultStore.getMessages(sessionId)).map(({ info, parts }) => ({
    id: info.id, role: info.role, text: parts.flatMap(part => part.type === "text" ? [part.text] : []).join(""), createdAt: info.time.created,
  }));
  return NextResponse.json({ session, workspaceName: workspace.name, messages, latestRun, memory, memoryEnabled: isMemoryConfigured() }, { headers: { "cache-control": "no-store" } });
}
