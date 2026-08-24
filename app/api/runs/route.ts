import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { unauthenticated } from "@/lib/api-error";
import { RunModel } from "@/models/run";
import { TaskModel } from "@/models/task";
import { WorkspaceModel } from "@/models/workspace";
import { WorkspaceUsageEventModel } from "@/models/workspace-usage-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — paginated run list for the current user.
 *  Query params:
 *    workspaceId  — filter by workspace
 *    status       — filter by run status
 *    limit        — page size (default 30, max 100)
 *    offset       — pagination offset (default 0) */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();

  const sp = request.nextUrl.searchParams;
  const workspaceId = sp.get("workspaceId") ?? undefined;
  const status = sp.get("status") ?? undefined;
  const limit = Math.min(Number(sp.get("limit")) || 30, 100);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  // Verify workspace access if specified
  if (workspaceId) {
    const ws = await WorkspaceModel.findOne({ workspaceId, userId: user.id }).select({ workspaceId: 1 }).lean();
    if (!ws) return NextResponse.json({ runs: [], total: 0 }, { headers: { "cache-control": "no-store" } });
  }

  const query: Record<string, unknown> = { userId: user.id };
  if (workspaceId) query.workspaceId = workspaceId;
  if (status) query.status = status;

  const [runs, total, taskCount] = await Promise.all([
    RunModel.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    RunModel.countDocuments(query),
    RunModel.countDocuments(query).then(() => 0), // placeholder
  ]);

  // Resolve task titles
  const taskIds = [...new Set(runs.map((run) => run.taskId))];
  const tasks = taskIds.length ? await TaskModel.find({ taskId: { $in: taskIds } }).select({ taskId: 1, title: 1, projectId: 1 }).lean() : [];
  const taskTitle = new Map(tasks.map((t) => [t.taskId, t.title]));

  // Aggregate token usage per run
  const runIds = runs.map((run) => run.runId);
  const usageRows = runIds.length
    ? await WorkspaceUsageEventModel.aggregate([
        { $match: { runId: { $in: runIds } } },
        { $group: { _id: "$runId", inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, cacheReadTokens: { $sum: "$cacheReadTokens" }, totalTokens: { $sum: "$totalTokens" } } },
      ])
    : [];
  const usageByRun = new Map(usageRows.map((row) => [row._id, { inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, totalTokens: row.totalTokens }]));

  // Resolve workspace names
  const wsIds = [...new Set(runs.map((run) => run.workspaceId))];
  const workspaces = wsIds.length ? await WorkspaceModel.find({ workspaceId: { $in: wsIds }, userId: user.id }).select({ workspaceId: 1, name: 1 }).lean() : [];
  const wsName = new Map(workspaces.map((ws) => [ws.workspaceId, ws.name]));

  const enriched = runs.map((run) => ({
    runId: run.runId,
    taskId: run.taskId,
    taskTitle: taskTitle.get(run.taskId) ?? "未知任务",
    workspaceId: run.workspaceId,
    workspaceName: wsName.get(run.workspaceId) ?? run.workspaceId,
    sessionId: run.sessionId,
    status: run.status,
    attempt: run.attempt,
    terminalReason: run.terminalReason,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    duration: run.startedAt && run.finishedAt ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000) : null,
    usage: usageByRun.get(run.runId) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 },
  }));

  return NextResponse.json({ runs: enriched, total, limit, offset }, { headers: { "cache-control": "no-store" } });
}
