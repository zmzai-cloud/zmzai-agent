import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getFrameworkRunner } from "@/framework/server/context";
import { connectMongo } from "@/lib/database/mongodb";
import { createRunForTask, createTaskForSession, taskForSession } from "@/lib/task-run-control";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { RunModel } from "@/models/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ userId: z.string().trim().refine(isWorkosUserId), prompt: z.string().trim().min(1).max(32 * 1024) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  const { userId, prompt } = parsed.data;
  await connectMongo();
  const { sessionId } = await context.params;
  const session = await getOwnedWorkosSession(sessionId, userId);
  if (!session) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  const active = await RunModel.findOne({ sessionId, userId, workspaceId: session.workspaceId, active: true }).sort({ createdAt: -1 }).lean();
  if (active) return NextResponse.json({ error: "ACTIVE_RUN_CONFLICT" }, { status: 409 });
  const task = await taskForSession(sessionId) ?? await createTaskForSession({ session, goal: prompt, source: "api" });
  const candidateRunId = `run_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const run = await createRunForTask({ task, session, runIdOverride: candidateRunId });
  // The unique active-run index arbitrates requests that passed the first read
  // concurrently. Only the caller whose candidate won may dispatch a prompt.
  if (run.runId !== candidateRunId) return NextResponse.json({ error: "ACTIVE_RUN_CONFLICT" }, { status: 409 });
  await getFrameworkRunner().prompt(sessionId, { text: prompt });
  return NextResponse.json({ runId: run.runId, status: "queued" }, { status: 202, headers: { "cache-control": "no-store" } });
}
