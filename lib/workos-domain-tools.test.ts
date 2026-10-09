import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ env: vi.fn(), activeRun: vi.fn() }));
vi.mock("@/config/env", () => ({ getServerEnvironment: m.env }));
vi.mock("@/lib/task-run-control", () => ({ activeRunIdForSession: m.activeRun }));

import { resolveWorkosDomainTools, workosCreateNoteTool, workosCreateTodoTool, workosUpdateNoteTool, workosUpdateTodoTool } from "./workos-domain-tools";

const ctx = { sessionId: "ses_1", userId: "507f1f77bcf86cd799439011", workspaceId: "ws_1", toolCallId: "call_1" };

beforeEach(() => {
  vi.resetAllMocks();
  m.env.mockReturnValue({ WORKOS_INTERNAL_URL: "https://workos.test", WORKOS_SERVICE_SECRET_CURRENT: "secret" });
  m.activeRun.mockResolvedValue("run_1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

it("registers the five domain tools with creation free of approval", () => {
  const tools = resolveWorkosDomainTools();
  expect(tools.map((tool) => tool.id)).toEqual(["workos_create_note", "workos_create_todo", "workos_read_note", "workos_update_note", "workos_update_todo"]);
  expect(workosCreateNoteTool.permission!({ title: "t", markdown: "" })).toBeNull();
  expect(workosCreateTodoTool.permission!({ title: "t", description: "", dueAt: null })).toBeNull();
});

it("update tools map to an ask-class permission carrying the proposal args", () => {
  const notePermission = workosUpdateNoteTool.permission!({ noteId: "note_1", markdown: "新正文" });
  expect(notePermission).toMatchObject({ permission: "workos", patterns: ["update_note:note_1"] });
  expect(notePermission!.metadata).toMatchObject({ action: "update_note", noteId: "note_1", markdown: "新正文" });

  const todoPermission = workosUpdateTodoTool.permission!({ todoId: "todo_1", status: "done" });
  expect(todoPermission).toMatchObject({ permission: "workos", patterns: ["update_todo:todo_1"] });
  expect(todoPermission!.metadata).toMatchObject({ action: "update_todo", todoId: "todo_1", status: "done" });
});

it("create_note posts an idempotent action and surfaces the noteId", async () => {
  const { calls } = stubFetch([{ body: { ok: true, actionId: "act_1", replayed: false, result: { noteId: "note_9" } } }]);
  const outcome = await workosCreateNoteTool.execute({ title: "整理的想法", markdown: "内容" }, ctx as never);
  expect(calls[0].url).toBe("https://workos.test/api/internal/agent/actions");
  const body = JSON.parse(String(calls[0].init.body));
  expect(body).toMatchObject({ userId: ctx.userId, sessionId: "ses_1", runId: "run_1", callId: "call_1", workspaceId: "ws_1", type: "create_note", title: "整理的想法" });
  expect(outcome.metadata).toMatchObject({ kind: "workos_note", noteId: "note_9" });
  expect(outcome.output).toContain("note_9");
});

it("update_note reads the current revision first and reuses it in the action", async () => {
  const { calls } = stubFetch([
    { body: { item: { noteId: "note_1", title: "旧", markdown: "旧正文", revision: 4 } } },
    { body: { ok: true, actionId: "act_2", replayed: false, result: { noteId: "note_1", revision: 5 } } },
  ]);
  const outcome = await workosUpdateNoteTool.execute({ noteId: "note_1", markdown: "新正文" }, ctx as never);
  expect(calls[0].url).toContain("/api/internal/agent/targets/note/note_1");
  const body = JSON.parse(String(calls[1].init.body));
  expect(body).toMatchObject({ type: "update_note", noteId: "note_1", markdown: "新正文", expectedRevision: 4 });
  expect(outcome.metadata).toMatchObject({ kind: "workos_note", noteId: "note_1", updated: true });
});

it("surfaces a revision conflict as an actionable model-facing error", async () => {
  stubFetch([
    { body: { item: { noteId: "note_1", markdown: "x", revision: 4 } } },
    { status: 409, body: { error: "REVISION_CONFLICT", current: { revision: 9 } } },
  ]);
  await expect(workosUpdateNoteTool.execute({ noteId: "note_1", markdown: "新正文" }, ctx as never)).rejects.toThrow("重新读取最新版本");
});

it("replayed actions are reported without re-creating anything", async () => {
  const { calls } = stubFetch([{ body: { ok: true, actionId: "act_1", replayed: true, result: { todoId: "todo_9" } } }]);
  const outcome = await workosCreateTodoTool.execute({ title: "提醒", description: "", dueAt: null }, ctx as never);
  expect(calls).toHaveLength(1);
  expect(outcome.metadata).toMatchObject({ kind: "workos_todo", todoId: "todo_9", replayed: true });
});

it("falls back to a session-scoped key when no active run exists", async () => {
  m.activeRun.mockResolvedValue(null);
  const { calls } = stubFetch([{ body: { ok: true, actionId: "act_1", replayed: false, result: { todoId: "todo_1" } } }]);
  await workosCreateTodoTool.execute({ title: "x", description: "", dueAt: null }, { ...ctx, toolCallId: undefined } as never);
  const body = JSON.parse(String(calls[0].init.body));
  expect(body.runId).toBe("session_ses_1");
  expect(String(body.callId)).toContain("ses_1");
});
