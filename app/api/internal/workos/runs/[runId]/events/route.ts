import { NextRequest, NextResponse } from "next/server";
import { subscribeFrameworkEvents } from "@/framework/core/events/bus";
import { FrameworkEventModel } from "@/framework/core/events/mongo-models";
import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { RunModel } from "@/models/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 本次 Run 的回放锚点：本 Run 用户消息投影的 seq（AI SDK Chat 的
 *  resumeStreamIsReplay 语义要求从 Run 开头整段重放，不能从中间续）。
 *
 *  【为什么必须按 run.createdAt 圈界】Run 文档创建于 runner.prompt() 之前，
 *  本 Run 的用户消息投影必然 at >= createdAt；而「全局最后一条用户消息」在
 *  POST /messages 返回与投影落库之间存在竞态——锚到上一轮会把上一轮的整个
 *  回答重放进新消息（实测踩中）。resume 型 Run 没有新用户消息：短暂等待后
 *  兜底取全局最后一条（正是该 Run 所属任务的起点）。 */
async function currentRunStartSeq(sessionId: string, runCreatedAt: Date): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bounded = await FrameworkEventModel.findOne(
      { sessionId, type: "message.updated", "data.message.role": "user", at: { $gte: runCreatedAt } },
      { seq: 1 },
    ).sort({ seq: -1 }).lean();
    if (bounded) return bounded.seq - 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const last = await FrameworkEventModel.findOne(
    { sessionId, type: "message.updated", "data.message.role": "user" },
    { seq: 1 },
  ).sort({ seq: -1 }).lean();
  return last ? last.seq - 1 : 0;
}

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  const rawSeq = request.nextUrl.searchParams.get("sinceSeq") ?? "0";
  const fromRunStart = request.nextUrl.searchParams.get("fromRunStart") === "1";
  if (!isWorkosUserId(userId) || !/^\d+$/.test(rawSeq) || !Number.isSafeInteger(Number(rawSeq))) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  await connectMongo();
  const { runId } = await context.params;
  const run = await RunModel.findOne({ runId, userId }).lean();
  if (!run) return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
  const session = await getOwnedWorkosSession(run.sessionId, userId);
  if (!session || session.workspaceId !== run.workspaceId) return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
  const sinceSeq = fromRunStart ? await currentRunStartSeq(session.id, run.createdAt) : Number(rawSeq);
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) abort.abort();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of subscribeFrameworkEvents(session.id, { sinceSeq, signal: abort.signal })) {
          controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...event.data, _seq: event.seq, _at: event.at })}\n\n`));
        }
      } catch {
        // Abort or durable-store failure: close without disclosing event data.
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try { controller.close(); } catch { /* cancelled by client */ }
      }
    },
    cancel() { abort.abort(); request.signal.removeEventListener("abort", onAbort); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
}
