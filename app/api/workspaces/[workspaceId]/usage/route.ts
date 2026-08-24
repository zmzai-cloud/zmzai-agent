import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { apiError, unauthenticated } from "@/lib/api-error";
import { WorkspaceUsageEventModel } from "@/models/workspace-usage-event";
import { WorkspaceModel } from "@/models/workspace";
import { ProjectModel } from "@/models/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyWorkspace(userId: string, workspaceId: string) {
  return WorkspaceModel.findOne({ workspaceId, userId }).select({ workspaceId: 1 }).lean();
}

/** GET — usage analytics for the current workspace.
 *  Returns summary + daily trend (30 days) + per-project breakdown. */
export async function GET(_: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { workspaceId } = await context.params;
  if (!(await verifyWorkspace(user.id, workspaceId))) return apiError("WORKSPACE_NOT_FOUND", 404, "Workspace 不存在或无权访问");

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const [summary, daily, projectBreakdown] = await Promise.all([
    // 1. Current period summary
    WorkspaceUsageEventModel.aggregate([
      { $match: { workspaceId, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, cacheReadTokens: { $sum: "$cacheReadTokens" }, totalTokens: { $sum: "$totalTokens" }, eventCount: { $sum: 1 } } },
    ]).then((rows) => rows[0] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, eventCount: 0 }),

    // 2. Daily trend (last 30 days)
    WorkspaceUsageEventModel.aggregate([
      { $match: { workspaceId, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, cacheReadTokens: { $sum: "$cacheReadTokens" }, totalTokens: { $sum: "$totalTokens" } } },
      { $sort: { _id: 1 } },
      { $project: { date: "$_id", inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, totalTokens: 1, _id: 0 } },
    ]),

    // 3. Per-project breakdown
    WorkspaceUsageEventModel.aggregate([
      { $match: { workspaceId, createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$taskId", inputTokens: { $sum: "$inputTokens" }, outputTokens: { $sum: "$outputTokens" }, cacheReadTokens: { $sum: "$cacheReadTokens" }, totalTokens: { $sum: "$totalTokens" } } },
    ]).then(async (taskRows) => {
      // Tasks don't store projectId directly; resolve via TaskModel
      const { TaskModel } = await import("@/models/task");
      const taskIds = taskRows.map((r) => r._id);
      const tasks = await TaskModel.find({ taskId: { $in: taskIds } }).select({ taskId: 1, projectId: 1, title: 1 }).lean();
      const taskProjectMap = new Map(tasks.map((t) => [t.taskId, { projectId: t.projectId, title: t.title }]));

      // Group by projectId
      const projectMap = new Map<string, { projectId: string; projectName: string; totalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; taskCount: number }>();
      for (const row of taskRows) {
        const meta = taskProjectMap.get(row._id);
        const projectId = meta?.projectId ?? "__unassigned__";
        const existing = projectMap.get(projectId);
        if (existing) {
          existing.totalTokens += row.totalTokens;
          existing.inputTokens += row.inputTokens;
          existing.outputTokens += row.outputTokens;
          existing.cacheReadTokens += row.cacheReadTokens;
          existing.taskCount++;
        } else {
          projectMap.set(projectId, { projectId, projectName: projectId, totalTokens: row.totalTokens, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, taskCount: 1 });
        }
      }
      return Array.from(projectMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    }),
  ]);

  // Resolve project names
  const projectIds = projectBreakdown.map((p) => p.projectId).filter((id) => id !== "__unassigned__");
  const nameMap = projectIds.length > 0
    ? new Map((await ProjectModel.find({ projectId: { $in: projectIds } }).select({ projectId: 1, name: 1 }).lean()).map((p) => [p.projectId, p.name]))
    : new Map<string, string>();
  for (const p of projectBreakdown) {
    p.projectName = p.projectId === "__unassigned__" ? "未分配项目" : (nameMap.get(p.projectId) ?? p.projectId);
  }

  return NextResponse.json({ summary, daily, byProject: projectBreakdown }, { headers: { "cache-control": "no-store" } });
}
