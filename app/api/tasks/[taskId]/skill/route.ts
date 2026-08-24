import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, unauthenticated } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth/session";
import { IdempotencyError, claimIdempotency } from "@/lib/idempotency";
import { canEditProject, getProjectAccess } from "@/lib/project-access";
import { addTaskWorkspaceSkill } from "@/lib/workspace-skills";
import { getWorkspace, updateWorkspace } from "@/lib/workspaces";
import { SandboxArtifactModel } from "@/models/sandbox-artifact";
import { TaskModel } from "@/models/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(2_000).optional(),
}).strict();

function inferDeliverableType(contentTypes: string[], goal: string): string {
  if (contentTypes.length) {
    const primary = contentTypes[0];
    const mapping: Record<string, string> = {
      "text/html": "HTML page / dashboard",
      "application/pdf": "PDF report",
      "text/markdown": "Markdown document",
      "application/json": "structured data (JSON)",
      "text/csv": "CSV dataset",
      "image/png": "image asset",
      "image/svg+xml": "SVG graphic",
    };
    if (mapping[primary]) return mapping[primary];
    if (primary.startsWith("text/")) return "text document";
    if (primary.startsWith("image/")) return "image asset";
    if (primary.startsWith("application/")) return "structured data";
    return primary;
  }
  const lower = goal.toLowerCase();
  if (/dashboard|landing|page|website|html/.test(lower)) return "HTML page";
  if (/report|document|doc/.test(lower)) return "document";
  if (/data|analysis|csv|chart/.test(lower)) return "data analysis";
  if (/image|design|logo|banner/.test(lower)) return "visual asset";
  return "";
}

function extractStepHints(goal: string): string[] {
  const verbs = goal.match(/\b(analyze|create|build|generate|extract|summarize|convert|design|implement|refactor|write|compile|review|test|deploy|migrate|optimize|debug|fix|calculate|transform|parse|render|export|import|integrate|configure|setup|install)\b/gi);
  if (!verbs || !verbs.length) return [];
  const unique = [...new Set(verbs.map((verb) => verb.toLowerCase()))];
  return unique.slice(0, 4).map((verb) => `${verb.charAt(0).toUpperCase() + verb.slice(1)} based on the user's specific inputs`);
}

async function buildSkillMarkdown(name: string, goal: string, taskId: string, title: string, latestRunId: string | null): Promise<string> {
  const contentTypes: string[] = latestRunId
    ? await SandboxArtifactModel.find({ runId: latestRunId }).select({ contentType: 1 }).sort({ createdAt: -1 }).limit(5).lean().then((artifacts) => artifacts.map((a) => a.contentType)).catch(() => [])
    : [];
  const deliverableType = inferDeliverableType(contentTypes, goal);
  const stepHints = extractStepHints(goal);
  const lines = [
    `# ${name}`,
    "",
    "## When to use",
    "Apply this skill when the user's request matches the pattern below. Identify the specific inputs, constraints, and deliverable format; reuse the operating procedure but verify all external state.",
    "",
    "## Reference goal",
    goal,
    "",
    "## Deliverable profile",
  ];
  if (deliverableType) lines.push(`- Type: ${deliverableType}`);
  lines.push(`- Source: Task ${taskId} (${title})`);
  lines.push(
    "",
    "## Operating procedure",
    "1. Confirm the inputs and constraints with the user's request",
  );
  if (stepHints.length) {
    stepHints.forEach((hint, index) => lines.push(`${index + 2}. ${hint}`));
  } else {
    lines.push("2. Execute the core workflow derived from the reference goal");
  }
  const nextStep = stepHints.length ? stepHints.length + 2 : 3;
  lines.push(
    `${nextStep}. Verify the output is directly usable`,
    `${nextStep + 1}. State important assumptions`,
    "",
    "## Constraints and quality gate",
    "- Output must be self-contained and immediately usable",
    "- State assumptions about external state explicitly",
    "- Verify the final result before reporting completion",
  );
  return lines.join("\n");
}

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthenticated();
  const { taskId } = await context.params;
  const task = await TaskModel.findOne({ taskId }).lean();
  if (!task) return apiError("TASK_NOT_FOUND", 404, "任务不存在或无权访问");
  const access = task.projectId ? await getProjectAccess(task.projectId, user.id) : task.userId === user.id ? { role: "owner" as const } : null;
  if (!access) return apiError("TASK_NOT_FOUND", 404, "任务不存在或无权访问");
  if (access.role !== "owner" && !canEditProject(access.role)) return apiError("FORBIDDEN", 403, "当前角色不能保存 Skill");
  if (task.status !== "succeeded") return apiError("TASK_NOT_COMPLETE", 409, "只有已完成任务可以保存为 Skill");
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("INVALID_BODY", 400, "Skill 格式不正确");

  let claim;
  try {
    claim = await claimIdempotency({ userId: user.id, scope: "task.skill", key: request.headers.get("idempotency-key"), body: { taskId, ...parsed.data }, resourceId: `skl_${randomUUID().replaceAll("-", "").slice(0, 20)}` });
  } catch (error) {
    if (error instanceof IdempotencyError) return apiError(error.code, error.code === "IDEMPOTENCY_KEY_REQUIRED" ? 400 : 409, error.code === "IDEMPOTENCY_KEY_REQUIRED" ? "Idempotency-Key 必须是 16 到 128 个可打印字符" : "同一 Idempotency-Key 不能对应不同请求");
    throw error;
  }

  const workspace = await getWorkspace(task.userId, task.workspaceId);
  if (!workspace) return apiError("WORKSPACE_NOT_FOUND", 404, "任务使用的 Workspace 不存在");
  const name = parsed.data.name ?? (task.title.trim().slice(0, 128) || "任务 Skill");
  const description = parsed.data.description ?? `来自已完成任务：${task.goal.trim().slice(0, 240)}`;
  const skill = await addTaskWorkspaceSkill({
    userId: task.userId,
    workspaceId: task.workspaceId,
    taskId: task.taskId,
    name,
    description,
    markdown: await buildSkillMarkdown(name, task.goal, task.taskId, task.title, task.latestRunId ?? null),
  });
  const skillIds = workspace.skillIds.includes(skill.skill.id) ? workspace.skillIds : [...workspace.skillIds, skill.skill.id];
  await updateWorkspace(task.userId, task.workspaceId, { skillIds });
  return NextResponse.json({ ...skill, enabled: true, replayed: claim.replayed }, { status: skill.reused ? 200 : 201, headers: { "cache-control": "no-store" } });
}
