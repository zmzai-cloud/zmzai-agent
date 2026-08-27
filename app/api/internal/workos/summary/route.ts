import { timingSafeEqual } from "node:crypto";

import { isValidObjectId } from "mongoose";
import { NextRequest, NextResponse } from "next/server";

import { getServerEnvironment } from "@/config/env";
import { connectMongo } from "@/lib/database/mongodb";
import { TaskModel } from "@/models/task";
import { WorkspaceModel } from "@/models/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(input: string | null, expected: string | undefined): boolean {
  if (!input || !expected) return false;
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** limit 查询参数：缺省 undefined（走默认 8）；非正整数/非数字返回 "invalid"；越界截断到 1–20。 */
function parseLimit(raw: string | null): number | "invalid" | undefined {
  if (raw === null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) return "invalid";
  const value = Number.parseInt(raw, 10);
  if (value < 1) return "invalid";
  return Math.min(value, 20);
}

/** workos（i.zmzai.cloud）服务间拉取：某用户的最近任务 + 智能体（含知识库计数）摘要。 */
export async function GET(request: NextRequest) {
  const environment = getServerEnvironment();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-workos-service-secret");
  const authorized =
    secretMatches(supplied, environment.WORKOS_SERVICE_SECRET_CURRENT) ||
    secretMatches(supplied, environment.WORKOS_SERVICE_SECRET_PREVIOUS);
  if (!authorized) return NextResponse.json({ error: "未授权的服务间请求" }, { status: 401 });

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

  return NextResponse.json(
    {
      tasks: tasks.map((task) => ({
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        workspaceId: task.workspaceId,
        updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : String(task.updatedAt),
      })),
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
