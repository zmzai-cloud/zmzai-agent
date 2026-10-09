import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ env: vi.fn(), workspace: vi.fn(), workspaces: vi.fn(), run: vi.fn(), session: vi.fn(), messages: vi.fn(), read: vi.fn(), settle: vi.fn(), subscribe: vi.fn(), prompt: vi.fn(), task: vi.fn(), createTask: vi.fn(), createRun: vi.fn(), createSession: vi.fn(), claim: vi.fn() }));
vi.mock("@/config/env", () => ({ getServerEnvironment: m.env }));
vi.mock("@/lib/database/mongodb", () => ({ connectMongo: vi.fn() }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { findOne: m.workspace, find: m.workspaces } }));
vi.mock("@/models/run", () => ({ RunModel: { findOne: m.run } }));
vi.mock("@/framework/core/runtime/runner", () => ({ defaultStore: { getSession: m.session, getMessages: m.messages }, createFrameworkSession: m.createSession }));
vi.mock("@/framework/server/context", () => ({ getFrameworkRunner: () => ({ prompt: m.prompt }) }));
vi.mock("@/lib/memory/run-state", () => ({ readMemoryRunState: m.read, settleStaleRetention: m.settle }));
vi.mock("@/framework/core/events/bus", () => ({ subscribeFrameworkEvents: m.subscribe }));
vi.mock("@/lib/task-run-control", () => ({ taskForSession: m.task, createTaskForSession: m.createTask, createRunForTask: m.createRun }));
vi.mock("@/lib/idempotency", () => ({ claimIdempotency: m.claim, IdempotencyError: class extends Error {} }));
const userId = "507f1f77bcf86cd799439011";
const session = { id: "ses_1", userId, workspaceId: "ws_1", title: "Conversation" };
const run = { runId: "run_1", sessionId: "ses_1", workspaceId: "ws_1", userId, status: "succeeded", active: false };
function chain(value: unknown) { return { lean: vi.fn().mockResolvedValue(value), sort: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() }; }
function req(query = "", secret: string | null = "secret", body?: unknown) { return new NextRequest(`http://localhost/api/test?userId=${userId}${query}`, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), headers: secret === null ? {} : { authorization: `Bearer ${secret}`, "idempotency-key": "one" } }); }
const ctx = { params: Promise.resolve({ sessionId: "ses_1", runId: "run_1" }) };
beforeEach(() => {
  vi.resetAllMocks();
  m.env.mockReturnValue({ WORKOS_SERVICE_SECRET_CURRENT: "secret", WORKOS_SERVICE_SECRET_PREVIOUS: "previous" });
  m.session.mockResolvedValue(session);
  m.workspace.mockReturnValue(chain({ workspaceId: "ws_1", name: "Workspace", defaultModel: "model" }));
  m.run.mockReturnValue(chain(run));
  m.messages.mockResolvedValue([{ info: { id: "msg_1", role: "assistant", time: { created: "now" } }, parts: [{ type: "text", text: "Hello" }, { type: "reasoning", text: "private reasoning" }, { type: "text", text: " world" }] }]);
  m.read.mockResolvedValue({ runId: "run_1", bankId: "ws_1", sessionId: "ses_1", recall: { hits: [{ text: "private fact" }] }, retention: { status: "pending" } });
  m.settle.mockResolvedValue({ retention: { status: "unknown" } });
  m.task.mockResolvedValue({ taskId: "task_1", userId, workspaceId: "ws_1" });
  m.createRun.mockImplementation(async (input) => ({ ...run, runId: input.runIdOverride ?? "run_1", status: "created" }));
  m.claim.mockResolvedValue({ resourceId: "ses_1", replayed: true });
});
import { GET } from "./route";
it.each([null, "bad"])("rejects invalid service secret %s", async (secret) => { expect((await GET(req("", secret), ctx)).status).toBe(401); expect(m.session).not.toHaveBeenCalled(); });
it("accepts previous secret and serializes text parts only, settling stale memory", async () => {
 const response = await GET(req("", "previous"), ctx); expect(response.status).toBe(200);
 const body = await response.json(); expect(body.messages[0]).toMatchObject({ id: "msg_1", role: "assistant", text: "Hello world" }); expect(JSON.stringify(body.messages)).not.toContain("private reasoning"); expect(body.memory.retention.status).toBe("unknown");
 expect(m.workspace).toHaveBeenCalledWith({ workspaceId: "ws_1", userId }); expect(m.run).toHaveBeenCalledWith({ sessionId: "ses_1", workspaceId: "ws_1", userId }); expect(m.settle).toHaveBeenCalledWith("run_1", expect.any(Date), null);
});
it.each(["other-user", "member-only"])("hides %s session facts", async (kind) => {
 if (kind === "other-user") m.session.mockResolvedValue({ ...session, userId: "other" }); else m.workspace.mockReturnValue(chain(null));
 const response = await GET(req(), ctx); expect(response.status).toBe(404); expect(await response.text()).not.toContain("private fact"); expect(m.messages).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled(); expect(m.settle).not.toHaveBeenCalled();
});
it("rejects missing user scope", async () => { expect((await GET(new NextRequest("http://localhost/api/test", { headers: { authorization: "Bearer secret" } }), ctx)).status).toBe(400); });
it("supports a session with no run or memory", async () => { m.run.mockReturnValue(chain(null)); const body = await (await GET(req(), ctx)).json(); expect(body.latestRun).toBeNull(); expect(body.memory).toBeNull(); expect(m.read).not.toHaveBeenCalled(); });
it("does not settle absent memory receipts", async () => { m.read.mockResolvedValue(null); expect((await (await GET(req(), ctx)).json()).memory).toBeNull(); expect(m.settle).not.toHaveBeenCalled(); });
it("passes terminal time for crash reconciliation and protects an active Run", async () => {
  const finishedAt = new Date("2026-10-08T10:00:00Z");
  m.read.mockResolvedValue({ runId: "run_1", retention: { status: "not_started" } });
  m.run.mockReturnValue(chain({ ...run, finishedAt }));
  await GET(req(), ctx);
  expect(m.settle).toHaveBeenLastCalledWith("run_1", expect.any(Date), finishedAt);
  m.run.mockReturnValue(chain({ ...run, active: true, status: "running", finishedAt: null }));
  await GET(req(), ctx);
  expect(m.settle).toHaveBeenLastCalledWith("run_1", expect.any(Date), null);
});
