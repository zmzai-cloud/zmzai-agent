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
it.each([null, "bad"])("rejects invalid secret %s", async secret => { expect((await GET(req("", secret))).status).toBe(401); expect(m.workspaces).not.toHaveBeenCalled(); });
it.each(["&limit=0", "&limit=-1", "&limit=1.5", "&cursor=bad", "&cursor=e30", "&cursor=eyJjcmVhdGVkQXQiOnsiJGd0IjowfSwid29ya3NwYWNlSWQiOiJ3cyJ9"])("rejects invalid pagination %s", async query => { expect((await GET(req(query))).status).toBe(400); expect(m.workspaces).not.toHaveBeenCalled(); });
it("lists only owned workspaces in stable order with a bounded limit", async () => { const c = chain([]); m.workspaces.mockReturnValue(c); const response = await GET(req("&limit=999")); expect(await response.json()).toEqual({ items: [], nextCursor: null }); expect(m.workspaces).toHaveBeenCalledWith({ userId }); expect(c.sort).toHaveBeenCalledWith({ createdAt: 1, workspaceId: 1 }); expect(c.limit).toHaveBeenCalledWith(101); });
it("round trips a tied-timestamp cursor without leaking workspace configuration", async () => {
 const createdAt = new Date("2026-10-08T00:00:00Z"); m.workspaces.mockReturnValue(chain([{ workspaceId: "ws_a", name: "A", createdAt, prompt: "private fact" }, { workspaceId: "ws_b", name: "B", createdAt }]));
 const response = await GET(req("&limit=1")); const body = await response.json(); expect(body.items).toEqual([{ workspaceId: "ws_a", name: "A", memoryEnabled: expect.any(Boolean) }]); expect(body.nextCursor).toEqual(expect.any(String));
 m.workspaces.mockReturnValue(chain([])); await GET(req(`&cursor=${encodeURIComponent(body.nextCursor)}`)); expect(m.workspaces).toHaveBeenLastCalledWith({ userId, $or: [{ createdAt: { $gt: createdAt } }, { createdAt, workspaceId: { $gt: "ws_a" } }] });
});
