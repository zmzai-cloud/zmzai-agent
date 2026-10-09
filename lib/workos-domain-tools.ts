import type { ToolDef } from "@zmzai/agent-framework";
import { z } from "zod";

import { getServerEnvironment } from "@/config/env";
import { activeRunIdForSession } from "@/lib/task-run-control";

/** 个人工作空间（WorkOS）领域工具：把 AI 对话落到用户自己的笔记与待办上。
 *
 *  数据权威在 WorkOS：这里每次写都带 (runId, callId) 幂等键，WorkOS 侧台账
 *  去重，重试与断线重连不会重复创建成果。创建类动作仅在用户明确要求时
 *  调用（免审批）；修改已有内容默认需要用户确认（permission 类 workos，
 *  无规则命中即 ask，workspace 规则可覆盖）。 */

export type WorkosActionType = "create_note" | "create_todo" | "update_note" | "update_todo";

type ActionResponse =
  | { ok: true; actionId: string; replayed: boolean; result: { noteId?: string; todoId?: string; revision?: number } }
  | { ok: false; actionId?: string; error: string; message?: string; current?: unknown };

const WORKOS_TIMEOUT_MS = 15_000;

function workosBase(): { base: string; secret: string | undefined } {
  const environment = getServerEnvironment();
  return { base: environment.WORKOS_INTERNAL_URL.replace(/\/$/, ""), secret: environment.WORKOS_SERVICE_SECRET_CURRENT };
}

async function readError(response: Response): Promise<string> {
  const json = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (json?.error === "REVISION_CONFLICT") return "内容刚被用户更新（REVISION_CONFLICT），请重新读取最新版本后再改写。";
  if (json?.error === "NOTE_NOT_FOUND" || json?.error === "TODO_NOT_FOUND") return "目标笔记或待办不存在（可能已被删除）。";
  return `个人工作空间返回 HTTP ${response.status}${json?.error ? `（${json.error}）` : ""}`;
}

async function dispatchWorkosAction(input: {
  userId: string;
  sessionId: string;
  runId: string;
  callId: string;
  workspaceId: string | null;
  action: Record<string, unknown> & { type: WorkosActionType };
}): Promise<ActionResponse> {
  const { base, secret } = workosBase();
  if (!secret) throw new Error("WORKOS_SERVICE_SECRET_CURRENT 未配置，无法写入个人工作空间");
  const response = await fetch(`${base}/api/internal/agent/actions`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ userId: input.userId, workspaceId: input.workspaceId, sessionId: input.sessionId, runId: input.runId, callId: input.callId, ...input.action }),
    cache: "no-store",
    signal: AbortSignal.timeout(WORKOS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(await readError(response));
  const json = (await response.json().catch(() => null)) as ActionResponse | null;
  if (!json || typeof json.ok !== "boolean") throw new Error("个人工作空间返回了无法解析的结果");
  return json;
}

async function readWorkosTarget(userId: string, kind: "note" | "todo", id: string): Promise<unknown> {
  const { base, secret } = workosBase();
  if (!secret) throw new Error("WORKOS_SERVICE_SECRET_CURRENT 未配置，无法读取个人工作空间");
  const response = await fetch(`${base}/api/internal/agent/targets/${kind}/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${secret}` },
    cache: "no-store",
    signal: AbortSignal.timeout(WORKOS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(kind === "note" ? `笔记 ${id} 不存在或不可读` : `待办 ${id} 不存在或不可读`);
  const json = (await response.json().catch(() => null)) as { item?: unknown } | null;
  return json?.item ?? null;
}

/** 工具执行时的运行身份：优先取会话当前活跃 Run，取不到时退回 sessionId 兜底键。 */
async function actionIdentity(ctx: { sessionId: string; userId: string; workspaceId: string; toolCallId?: string }) {
  const runId = await activeRunIdForSession(ctx.sessionId).catch(() => null);
  return { runId: runId ?? `session_${ctx.sessionId}`, callId: ctx.toolCallId ?? `call_${ctx.sessionId}_${Date.now()}` };
}

async function runAction(ctx: { sessionId: string; userId: string; workspaceId: string; toolCallId?: string }, action: Record<string, unknown> & { type: WorkosActionType }): Promise<ActionResponse> {
  const identity = await actionIdentity(ctx);
  return dispatchWorkosAction({ userId: ctx.userId, sessionId: ctx.sessionId, workspaceId: ctx.workspaceId, ...identity, action });
}

export const workosCreateNoteTool: ToolDef = {
  id: "workos_create_note",
  label: "工作空间 · 保存笔记",
  description:
    "在用户的个人工作空间保存一篇 Markdown 笔记。仅当用户明确要求「保存为笔记 / 记下来 / 存成笔记」等意图时调用；" +
    "未经用户要求不要主动创建。返回的 noteId 可用于后续更新。",
  parameters: z.object({
    title: z.string().min(1).max(240).describe("笔记标题，简洁概括内容"),
    markdown: z.string().max(256 * 1024).default("").describe("笔记正文，Markdown 格式"),
  }),
  permission: () => null,
  executionMode: "sequential",
  async execute(args, ctx) {
    const outcome = await runAction(ctx, { type: "create_note", title: args.title, markdown: args.markdown });
    if (!outcome.ok) throw new Error(outcome.message ?? `保存笔记失败（${outcome.error}）`);
    const noteId = outcome.result.noteId ?? "";
    return {
      title: `保存笔记「${args.title}」`,
      output: `已保存到用户的个人工作空间（noteId: ${noteId}）。用户可以在对话右侧或「笔记」页查看和编辑。`,
      metadata: { kind: "workos_note", noteId, replayed: outcome.replayed },
    };
  },
};

export const workosCreateTodoTool: ToolDef = {
  id: "workos_create_todo",
  label: "工作空间 · 创建待办",
  description:
    "在用户的个人工作空间创建一条个人待办。仅当用户明确要求创建待办 / 下一步 / 提醒时调用；一条一件事，多件事就多次调用。 " +
    "dueAt 使用 ISO 8601 时间（如 2026-10-12T09:00:00Z）；用户没有给出明确日期时必须留空，不要编造日期。",
  parameters: z.object({
    title: z.string().min(1).max(240).describe("待办标题，一句话行动项"),
    description: z.string().max(8 * 1024).default("").describe("补充说明，可留空"),
    dueAt: z.string().datetime().nullable().default(null).describe("截止时间 ISO 8601；无明确日期则传 null"),
  }),
  permission: () => null,
  executionMode: "sequential",
  async execute(args, ctx) {
    const outcome = await runAction(ctx, { type: "create_todo", title: args.title, description: args.description, dueAt: args.dueAt });
    if (!outcome.ok) throw new Error(outcome.message ?? `创建待办失败（${outcome.error}）`);
    const todoId = outcome.result.todoId ?? "";
    return {
      title: `创建待办「${args.title}」`,
      output: `已加入用户的待办列表（todoId: ${todoId}${args.dueAt ? `，截止 ${args.dueAt}` : "，未排期"}）。`,
      metadata: { kind: "workos_todo", todoId, replayed: outcome.replayed },
    };
  },
};

export const workosReadNoteTool: ToolDef = {
  id: "workos_read_note",
  label: "工作空间 · 读取笔记",
  description: "读取用户个人工作空间里的一篇笔记当前内容与 revision（noteId 形如 note_xxx）。改写前应先读取最新版本。",
  parameters: z.object({ noteId: z.string().min(1).max(80) }),
  permission: () => null,
  executionMode: "sequential",
  async execute(args, ctx) {
    const item = (await readWorkosTarget(ctx.userId, "note", args.noteId)) as { title?: string; markdown?: string; revision?: number } | null;
    if (!item) throw new Error(`笔记 ${args.noteId} 不存在`);
    return {
      title: `读取笔记「${item.title ?? args.noteId}」`,
      output: `revision: ${item.revision ?? "?"}\n标题: ${item.title ?? ""}\n\n${item.markdown ?? ""}`,
      metadata: { kind: "workos_note_read", noteId: args.noteId, revision: item.revision },
    };
  },
};

export const workosUpdateNoteTool: ToolDef = {
  id: "workos_update_note",
  label: "工作空间 · 改写笔记",
  description:
    "改写用户工作空间里已有的一篇笔记（传完整的新 Markdown 正文）。这会覆盖笔记内容，必须先征得用户确认后才会执行；" +
    "改写前先用 workos_read_note 读取最新版本。未经用户要求不要调用。",
  parameters: z.object({
    noteId: z.string().min(1).max(80),
    title: z.string().min(1).max(240).optional().describe("新标题；不改标题可省略"),
    markdown: z.string().max(256 * 1024).describe("改写后的完整 Markdown 正文"),
  }),
  permission: (args) => ({
    permission: "workos",
    patterns: [`update_note:${args.noteId}`],
    metadata: { action: "update_note", noteId: args.noteId, title: args.title ?? null, markdown: args.markdown },
  }),
  executionMode: "sequential",
  async execute(args, ctx) {
    const current = (await readWorkosTarget(ctx.userId, "note", args.noteId)) as { revision?: number } | null;
    if (!current?.revision) throw new Error(`笔记 ${args.noteId} 不存在`);
    const outcome = await runAction(ctx, { type: "update_note", noteId: args.noteId, markdown: args.markdown, ...(args.title !== undefined ? { title: args.title } : {}), expectedRevision: current.revision });
    if (!outcome.ok) throw new Error(outcome.message ?? `改写笔记失败（${outcome.error}）`);
    return {
      title: `改写笔记 ${args.noteId}`,
      output: `笔记已更新（revision ${outcome.result.revision ?? "?"}）。`,
      metadata: { kind: "workos_note", noteId: args.noteId, updated: true },
    };
  },
};

export const workosUpdateTodoTool: ToolDef = {
  id: "workos_update_todo",
  label: "工作空间 · 更新待办",
  description:
    "更新用户工作空间里的一条待办（todoId 形如 todo_xxx）：可改标题、说明、截止时间或完成状态。会改动用户数据，需用户确认后执行。",
  parameters: z.object({
    todoId: z.string().min(1).max(80),
    title: z.string().min(1).max(240).optional(),
    description: z.string().max(8 * 1024).optional(),
    dueAt: z.string().datetime().nullable().optional().describe("新截止时间；传 null 表示改为未排期"),
    status: z.enum(["open", "done"]).optional().describe("done 表示完成，open 表示恢复"),
  }),
  permission: (args) => ({
    permission: "workos",
    patterns: [`update_todo:${args.todoId}`],
    metadata: { action: "update_todo", ...args },
  }),
  executionMode: "sequential",
  async execute(args, ctx) {
    const outcome = await runAction(ctx, {
      type: "update_todo",
      todoId: args.todoId,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.dueAt !== undefined ? { dueAt: args.dueAt } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    });
    if (!outcome.ok) throw new Error(outcome.message ?? `更新待办失败（${outcome.error}）`);
    return {
      title: `更新待办 ${args.todoId}`,
      output: `待办已更新${args.status === "done" ? "（已完成）" : ""}。`,
      metadata: { kind: "workos_todo", todoId: args.todoId, updated: true },
    };
  },
};

/** 全部 WorkOS 领域工具。注册在 workspace 智能体的工具集里。 */
export function resolveWorkosDomainTools(): ToolDef[] {
  return [workosCreateNoteTool, workosCreateTodoTool, workosReadNoteTool, workosUpdateNoteTool, workosUpdateTodoTool];
}
