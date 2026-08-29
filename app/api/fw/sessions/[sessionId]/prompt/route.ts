import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { defaultStore } from "@/framework/core/runtime/runner";
import { getFrameworkRunner } from "@/framework/server/context";
import { ensureRunForPrompt } from "@/lib/task-run-control";
import { RunModel } from "@/models/run";
import { TaskModel } from "@/models/task";
import { canRunProject, getProjectAccess } from "@/lib/project-access";
import { maybeGenerateSessionTitle } from "@/lib/fw-session-title";
import { runWithTrace } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageSchema = z.object({ url: z.string().min(1).max(20 * 1024 * 1024), mediaType: z.string().regex(/^image\//) });

const promptSchema = z
  .object({
    text: z.string().trim().min(1).max(32 * 1024),
    agent: z.string().trim().min(1).max(64).optional(),
    images: z.array(imageSchema).max(4).optional(),
  })
  .strict();

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  // 入口绑定 trace：从 x-trace-id 透传或新生成，出站 relay/sandbox 调用自动携带
  return runWithTrace(request, () => handlePrompt(request, context));
}

async function handlePrompt(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { sessionId } = await context.params;
  const session = await defaultStore.getSession(sessionId);
  if (!session) return apiError("SESSION_NOT_FOUND", 404, "会话不存在或无权访问");
  if (session.userId !== user.id) {
    const run = await RunModel.findOne({ sessionId }).sort({ createdAt: -1 }).lean();
    const task = run ? await TaskModel.findOne({ taskId: run.taskId }).lean() : null;
    const access = task?.projectId ? await getProjectAccess(task.projectId, user.id) : null;
    if (!task || !access || !canRunProject(access.role)) return apiError("SESSION_NOT_FOUND", 404, "会话不存在或无权访问");
  }

  const parsed = promptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "prompt 请求格式不正确");

  const activeRun = await RunModel.findOne({ sessionId, active: true }).sort({ createdAt: -1 }).lean();
  // A missing in-memory runner after a restart does not prove that a prior
  // side effect stopped. Only explicitly paused or waiting-input Runs can be
  // superseded; running/waiting-approval Runs must settle through recovery.
  const forceNewRun = Boolean(activeRun && ["paused", "waiting_input"].includes(activeRun.status));
  const control = await ensureRunForPrompt(session, parsed.data.text, {
    forceNewRun,
    ...(forceNewRun && activeRun ? { parentRunId: activeRun.runId, resumeCheckpointId: activeRun.latestCheckpointId } : {}),
  });
  const result = await getFrameworkRunner().prompt(sessionId, {
    text: parsed.data.text,
    ...(parsed.data.agent ? { agent: parsed.data.agent } : {}),
    ...(parsed.data.images?.length ? { images: parsed.data.images } : {}),
  });
  // spec §13.2：先建会话后发首条 prompt 的场景，标题也异步生成（默认值守卫防重复）
  void maybeGenerateSessionTitle({ sessionId, prompt: parsed.data.text });
  return NextResponse.json({ accepted: true, queued: result.queued, task: control.task, run: control.run }, { status: 202, headers: { "cache-control": "no-store" } });
}
