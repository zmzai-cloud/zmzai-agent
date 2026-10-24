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
  // parts 供 WorkOS 前端把历史折叠成与直播一致的富消息（text/tool 状态）。
  // reasoning 不出详情接口（既有隐私边界，route.test 显式断言），直播侧适配器同样跳过。
  // 工具 output 只带截断文本——详情接口走整页加载，全量工具产物不该出现在这里。
  const messages = (await defaultStore.getMessages(sessionId)).map(({ info, parts }) => ({
    id: info.id, role: info.role, createdAt: info.time.created,
    text: parts.flatMap(part => part.type === "text" ? [part.text] : []).join(""),
    parts: parts.flatMap((part): Array<Record<string, unknown>> => {
      if (part.type === "text") return [{ type: "text" as const, id: part.id, text: part.text }];
      if (part.type === "tool") return [{ type: "tool" as const, id: part.id, callId: part.callId, tool: part.tool, state: { status: part.state.status, title: "title" in part.state ? part.state.title : undefined, error: "error" in part.state ? String(part.state.error).slice(0, 400) : undefined } }];
      if (part.type === "step-start") return [{ type: "step-start" as const, id: part.id }];
      if (part.type === "step-finish") return [{ type: "step-finish" as const, id: part.id, tokens: part.tokens }];
      if (part.type === "subtask") return [{ type: "subtask" as const, id: part.id, prompt: part.prompt, description: part.description, agent: part.agent, childSessionId: part.childSessionId }];
      return [];
    }),
  }));
  return NextResponse.json({ session, workspaceName: workspace.name, messages, latestRun, memory, memoryEnabled: isMemoryConfigured() }, { headers: { "cache-control": "no-store" } });
}
