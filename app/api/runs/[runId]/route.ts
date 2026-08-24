import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { defaultStore } from "@/framework/core/runtime/runner";
import { readFrameworkEvents } from "@/framework/core/events/bus";
import { RunModel } from "@/models/run";
import { TaskModel } from "@/models/task";
import { WorkspaceModel } from "@/models/workspace";
import { WorkspaceUsageEventModel } from "@/models/workspace-usage-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — single run detail with session messages, tool timeline, and token usage. */
export async function GET(_: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { runId } = await context.params;

  const run = await RunModel.findOne({ runId, userId: user.id }).lean();
  if (!run) return apiError("RUN_NOT_FOUND", 404, "运行记录不存在或无权访问");

  // Resolve related entities in parallel
  const [task, workspace, usageRows, events, messages] = await Promise.all([
    TaskModel.findOne({ taskId: run.taskId }).select({ taskId: 1, title: 1, projectId: 1 }).lean(),
    WorkspaceModel.findOne({ workspaceId: run.workspaceId, userId: user.id }).select({ workspaceId: 1, name: 1 }).lean(),
    WorkspaceUsageEventModel.aggregate([
      { $match: { runId } },
      { $group: { _id: null, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, cacheReadTokens: { $sum: "$cacheReadTokens" }, cacheWriteTokens: { $sum: "$cacheWriteTokens" }, totalTokens: { $sum: "$totalTokens" }, eventCount: { $sum: 1 } } },
    ]).then((rows) => rows[0] ?? null),
    readFrameworkEvents(run.sessionId, 0, 5_000),
    defaultStore.getMessages(run.sessionId),
  ]);

  // Build tool timeline from session messages
  const toolTimeline = messages
    .flatMap((entry) => entry.parts)
    .filter((part): part is Extract<typeof part, { type: "tool" }> => part.type === "tool")
    .map((part) => ({
      callId: part.callId,
      tool: part.tool,
      status: part.state.status,
      title: part.state.status === "completed" ? (part.state.title ?? null) : part.state.status === "running" ? (part.state.title ?? null) : null,
      output: part.state.status === "completed" ? (part.state.output ?? null) : part.state.status === "error" ? (part.state.error ?? null) : null,
      startedAt: part.state.status !== "pending" ? part.state.time.start : null,
      endedAt: part.state.status === "completed" || part.state.status === "error" ? part.state.time.end : null,
    }));

  // Token usage from message info (assistant messages with tokens)
  const messageTokens = messages
    .filter((entry) => entry.info.role === "assistant")
    .filter((entry): entry is typeof entry & { info: Extract<typeof entry.info, { role: "assistant" }> } => "tokens" in entry.info && !!entry.info.tokens)
    .map((entry) => ({
      messageId: entry.info.id,
      input: entry.info.tokens?.input ?? 0,
      output: entry.info.tokens?.output ?? 0,
      cacheRead: entry.info.tokens?.cacheRead ?? 0,
    }));

  // Subagent runs (if any)
  const { SubagentRunModel } = await import("@/models/subagent-run");
  const subagents = await SubagentRunModel.find({ taskId: run.taskId }).sort({ createdAt: -1 }).lean();

  const duration = run.startedAt && run.finishedAt
    ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;

  return NextResponse.json(
    {
      run: {
        runId: run.runId,
        taskId: run.taskId,
        taskTitle: task?.title ?? "未知任务",
        projectId: task?.projectId ?? null,
        workspaceId: run.workspaceId,
        workspaceName: workspace?.name ?? run.workspaceId,
        sessionId: run.sessionId,
        status: run.status,
        attempt: run.attempt,
        parentRunId: run.parentRunId,
        terminalReason: run.terminalReason,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        duration,
      },
      usage: usageRows ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, eventCount: 0 },
      toolTimeline,
      messageTokens,
      events: events.map((event) => ({ seq: event.seq, type: event.type, at: event.at, data: event.data })),
      subagents: subagents.map((s) => ({ subagentRunId: s.subagentRunId, agent: s.agent, description: s.description, status: s.status, error: s.error ?? null })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
