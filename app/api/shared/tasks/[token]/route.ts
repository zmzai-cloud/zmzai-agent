import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { defaultStore } from "@/framework/core/runtime/runner";
import { TaskModel } from "@/models/task";
import { RunModel } from "@/models/run";
import { TaskShareModel } from "@/models/task-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — 公开查看分享的任务对话（无需登录） */
export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const share = await TaskShareModel.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean();
  if (!share) {
    return NextResponse.json({ error: "分享不存在或已过期" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const task = await TaskModel.findOne({ taskId: share.taskId }).select({ taskId: 1, title: 1, status: 1, createdAt: 1 }).lean();
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const runs = await RunModel.find({ taskId: share.taskId }).sort({ createdAt: -1 }).limit(50).select({ runId: 1, sessionId: 1, status: 1, createdAt: 1 }).lean();
  const sessionId = runs[0]?.sessionId;
  const messages = sessionId ? await defaultStore.getMessages(sessionId) : [];

  // 脱敏：移除内部 ID、user 身份等
  const sanitizedMessages = messages.map((entry) => ({
    info: {
      id: entry.info.id,
      role: entry.info.role,
      time: entry.info.time,
      ...(entry.info.role === "assistant" && "tokens" in entry.info && entry.info.tokens ? { tokens: entry.info.tokens } : {}),
    },
    parts: entry.parts.map((part) => {
      if (part.type === "text") return { id: part.id, type: "text" as const, text: part.text };
      if (part.type === "reasoning") return { id: part.id, type: "reasoning" as const, text: part.text };
      if (part.type === "tool") return { id: part.id, type: "tool" as const, tool: part.tool, state: { status: part.state.status } };
      if (part.type === "image") return { id: part.id, type: "image" as const, url: part.url, mediaType: part.mediaType, alt: part.alt };
      return { id: part.id, type: part.type };
    }),
  }));

  return NextResponse.json({
    task: {
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
    },
    messages: sanitizedMessages,
    expiresAt: share.expiresAt.toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
