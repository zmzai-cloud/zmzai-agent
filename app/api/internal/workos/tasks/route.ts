import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isWorkosServiceAuthorized } from "@/lib/workos-service-auth";
import { createFrameworkSession, defaultStore } from "@/framework/core/runtime/runner";
import { getFrameworkRunner } from "@/framework/server/context";
import { connectMongo } from "@/lib/database/mongodb";
import { IdempotencyError, claimIdempotency } from "@/lib/idempotency";
import { createRunForTask, createTaskForSession, taskForSession } from "@/lib/task-run-control";
import { RunModel, type RunRecord } from "@/models/run";
import { WorkspaceModel } from "@/models/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  userId: z.string().trim().min(1).max(80),
  workspaceId: z.string().trim().min(1).max(64),
  goal: z.string().trim().min(1).max(32 * 1024),
  title: z.string().trim().min(1).max(240).optional(),
}).strict();

/** workos 仅能代表已登录用户创建其自身 workspace 中的 Agent 任务。 */
export async function POST(request: NextRequest) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "未授权的服务间请求" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "任务请求格式不正确" }, { status: 400 });
  const data = parsed.data;
  await connectMongo();
  const workspace = await WorkspaceModel.findOne({ workspaceId: data.workspaceId, userId: data.userId }).lean();
  if (!workspace) return NextResponse.json({ error: "Workspace 不存在或无权访问" }, { status: 404 });

  let claim;
  try {
    claim = await claimIdempotency({
      userId: data.userId,
      scope: "workos.task.create",
      key: request.headers.get("idempotency-key"),
      body: data,
      resourceId: `ses_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    });
  } catch (error) {
    if (error instanceof IdempotencyError) {
      return NextResponse.json({ error: error.code }, { status: error.code === "IDEMPOTENCY_KEY_REQUIRED" ? 400 : 409 });
    }
    throw error;
  }

  let session = await defaultStore.getSession(claim.resourceId);
  if (!session) {
    session = await createFrameworkSession({
      store: defaultStore,
      id: claim.resourceId,
      userId: data.userId,
      workspaceId: workspace.workspaceId,
      agent: workspace.name,
      model: { providerId: "relay", modelId: workspace.defaultModel },
      prompt: data.goal,
      title: data.title ?? data.goal.slice(0, 80),
    });
  }
  if (session.userId !== data.userId || session.workspaceId !== workspace.workspaceId) {
    return NextResponse.json({ error: "Workspace 不存在或无权访问" }, { status: 404 });
  }
  let task = await taskForSession(session.id);
  const existingRun = task ? await RunModel.findOne({ taskId: task.taskId }).sort({ createdAt: -1 }).lean() as RunRecord | null : null;
  if (task && existingRun && claim.replayed) {
    return NextResponse.json({ sessionId: session.id, taskId: task.taskId, runId: existingRun.runId, status: existingRun.status, replayed: true }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  if (!task) task = await createTaskForSession({ session, goal: data.goal, title: data.title, source: "api" });
  const run = existingRun ?? await createRunForTask({ task, session });
  await getFrameworkRunner().prompt(session.id, { text: data.goal });
  return NextResponse.json({ sessionId: session.id, taskId: task.taskId, runId: run.runId, status: "queued", replayed: claim.replayed }, { status: 202, headers: { "cache-control": "no-store" } });
}
