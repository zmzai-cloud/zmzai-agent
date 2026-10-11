import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { connectMongo } from "@/lib/database/mongodb";
import { isWorkosServiceAuthorized, isWorkosUserId } from "@/lib/workos-service-auth";
import { getOwnedWorkosSession } from "@/lib/workos-session-access";
import { getFrameworkRunner } from "@/framework/server/context";
import { projectApprovalReply } from "@/lib/approval-projection";
import { ApprovalRequestModel } from "@/models/approval";
import { RunModel } from "@/models/run";
import { TaskModel } from "@/models/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const replySchema = z
  .object({
    userId: z.string().trim().min(1),
    reply: z.enum(["once", "always", "reject"]),
    feedback: z.string().trim().max(2_000).optional(),
  })
  .strict();

/** WorkOS 对话页的审批回复入口（服务鉴权版，语义对齐 quill 的
 *  sessions/[sessionId]/permissions/[requestId]）。 */
export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string; requestId: string }> }) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { sessionId, requestId } = await context.params;
  const parsed = replySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  if (!isWorkosUserId(parsed.data.userId)) return NextResponse.json({ error: "INVALID_USER_ID" }, { status: 400 });
  await connectMongo();

  const session = await getOwnedWorkosSession(sessionId, parsed.data.userId);
  if (!session) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  const run = (await RunModel.findOne({ sessionId, userId: parsed.data.userId, active: true }).sort({ createdAt: -1 }).lean())
    ?? (await RunModel.findOne({ sessionId, userId: parsed.data.userId }).sort({ createdAt: -1 }).lean());
  const task = run ? await TaskModel.findOne({ taskId: run.taskId }).lean() : null;
  if (!task || !run) return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
  const approval = await ApprovalRequestModel.findOne({ requestId, taskId: task.taskId, runId: run.runId, status: "pending" }).lean();
  if (!approval) return NextResponse.json({ error: "PERMISSION_REQUEST_NOT_FOUND" }, { status: 404 });

  const resolved = await getFrameworkRunner().replyPermission(sessionId, requestId, parsed.data.reply, parsed.data.feedback);
  if (!resolved) return NextResponse.json({ error: "PERMISSION_REQUEST_NOT_FOUND" }, { status: 404 });
  await projectApprovalReply({ sessionId, requestId, reply: parsed.data.reply, decidedBy: parsed.data.userId, feedback: parsed.data.feedback });
  return NextResponse.json({ resolved: true }, { headers: { "cache-control": "no-store" } });
}
