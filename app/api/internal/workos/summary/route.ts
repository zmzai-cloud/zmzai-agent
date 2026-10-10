import { isValidObjectId } from "mongoose";
import { NextRequest, NextResponse } from "next/server";

import { isWorkosServiceAuthorized } from "@/lib/workos-service-auth";
import { connectMongo } from "@/lib/database/mongodb";
import { TaskModel } from "@/models/task";
import { RunModel } from "@/models/run";
import { WorkspaceModel } from "@/models/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/** limit 查询参数：缺省 undefined（走默认 8）；非正整数/非数字返回 "invalid"；越界截断到 1–20。 */
function parseLimit(raw: string | null): number | "invalid" | undefined {
  if (raw === null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) return "invalid";
  const value = Number.parseInt(raw, 10);
  if (value < 1) return "invalid";
  return Math.min(value, 20);
}

/** workos（workos.zmzai.cloud）服务间拉取：某用户的最近任务 + 智能体（含知识库计数）摘要。 */
export async function GET(request: NextRequest) {
  if (!isWorkosServiceAuthorized(request)) return NextResponse.json({ error: "未授权的服务间请求" }, { status: 401 });

  const userId = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  if (!isValidObjectId(userId)) return NextResponse.json({ error: "userId 非法" }, { status: 400 });

  const taskLimit = parseLimit(request.nextUrl.searchParams.get("taskLimit"));
  const workspaceLimit = parseLimit(request.nextUrl.searchParams.get("workspaceLimit"));
  if (taskLimit === "invalid" || workspaceLimit === "invalid") {
    return NextResponse.json({ error: "limit 参数非法" }, { status: 400 });
  }

  await connectMongo();
  const [tasks, workspaces] = await Promise.all([
    TaskModel.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(taskLimit ?? 8)
      .select({ taskId: 1, title: 1, status: 1, workspaceId: 1, updatedAt: 1 })
      .lean(),
    WorkspaceModel.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(workspaceLimit ?? 8)
      .select({ workspaceId: 1, name: 1, description: 1, knowledgeBase: 1, updatedAt: 1 })
      .lean(),
  ]);
  const taskIds = tasks.map((task) => task.taskId);
  const runs = taskIds.length
    ? await RunModel.find({ taskId: { $in: taskIds } }).sort({ createdAt: -1 }).select({ taskId: 1, sessionId: 1, status: 1, createdAt: 1 }).lean()
    : [];
  const latestRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!latestRun.has(run.taskId)) latestRun.set(run.taskId, run);

  return NextResponse.json(
    {
      tasks: tasks.map((task) => {
        const run = latestRun.get(task.taskId);
        const attention = run?.status === "waiting_approval" ? "需要授权后才能继续" : run?.status === "waiting_input" ? "需要补充输入后才能继续" : null;
        return {
          taskId: task.taskId,
          title: task.title,
          status: task.status,
          workspaceId: task.workspaceId,
          updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : String(task.updatedAt),
          runStatus: run?.status ?? null,
          sessionId: run?.sessionId ?? null,
          attention,
        };
      }),
      workspaces: workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        name: workspace.name,
        description: workspace.description,
        knowledgeCount: workspace.knowledgeBase?.length ?? 0,
        updatedAt: workspace.updatedAt instanceof Date ? workspace.updatedAt.toISOString() : String(workspace.updatedAt),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
