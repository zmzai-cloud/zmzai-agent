import { NextRequest, NextResponse } from "next/server";
import { subscribeFrameworkEvents } from "@/framework/core/events/bus";
import { FrameworkEventModel } from "@/framework/core/events/mongo-models";
import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { RunModel } from "@/models/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 本次（最后一个）Run 的回放锚点：会话事件流里最后一条用户消息投影的 seq。
 *  WorkOS 前端断线重连需要「从本 Run 开头整段重放」（AI SDK Chat 的
 *  resumeStreamIsReplay 语义），而不是从中间 seq 续——续流面对已折叠的客户端
 *  状态无法对齐 text part。一个会话同一时刻只有一个活跃 Run，最后一条用户消息
 *  就是它的起点；resume 型 Run（不产生新用户消息）会多回放上一段，由订阅端
 *  按需裁剪，可接受。 */
async function currentRunStartSeq(sessionId: string): Promise<number> {
  const anchor = await FrameworkEventModel.findOne(
    { sessionId, type: "message.updated", "data.message.role": "user" },
    { seq: 1 },
  ).sort({ seq: -1 }).lean();
  return anchor ? anchor.seq - 1 : 0;
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
  const sinceSeq = fromRunStart ? await currentRunStartSeq(session.id) : Number(rawSeq);
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
