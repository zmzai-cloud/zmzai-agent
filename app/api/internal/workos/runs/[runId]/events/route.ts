import { NextRequest, NextResponse } from "next/server";
import { subscribeFrameworkEvents } from "@/framework/core/events/bus";
import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { RunModel } from "@/models/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  const rawSeq = request.nextUrl.searchParams.get("sinceSeq") ?? "0";
  if (!isWorkosUserId(userId) || !/^\d+$/.test(rawSeq) || !Number.isSafeInteger(Number(rawSeq))) return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  await connectMongo();
  const { runId } = await context.params;
  const run = await RunModel.findOne({ runId, userId }).lean();
  if (!run) return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
  const session = await getOwnedWorkosSession(run.sessionId, userId);
  if (!session || session.workspaceId !== run.workspaceId) return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) abort.abort();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of subscribeFrameworkEvents(session.id, { sinceSeq: Number(rawSeq), signal: abort.signal })) {
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
