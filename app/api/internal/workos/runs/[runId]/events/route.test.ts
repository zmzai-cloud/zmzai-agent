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
it.each([null, "bad"])("rejects invalid secret %s", async secret => { expect((await GET(req("", secret), ctx)).status).toBe(401); expect(m.run).not.toHaveBeenCalled(); });
it.each(["-1", "1.5", "1e2", "abc", "9007199254740992", "%7B%22$gt%22:0%7D"])("rejects malicious cursor %s", async cursor => { expect((await GET(req(`&sinceSeq=${cursor}`), ctx)).status).toBe(400); expect(m.subscribe).not.toHaveBeenCalled(); });
it.each(["run", "session", "workspace"])("hides unauthorized %s events", async kind => { if(kind === "run") m.run.mockReturnValue(chain(null)); if(kind === "session") m.session.mockResolvedValue({ ...session, userId: "other" }); if(kind === "workspace") m.workspace.mockReturnValue(chain(null)); const response = await GET(req(), ctx); expect(response.status).toBe(404); expect(await response.text()).not.toContain("private fact"); expect(m.subscribe).not.toHaveBeenCalled(); });
it("replays memory events using durable sequence ids", async () => {
 m.subscribe.mockImplementation(async function* () { yield { seq: 42, sessionId: "ses_1", type: "memory.recall", at: "now", data: { runId: "run_1", hits: [{ text: "private fact" }] } }; yield { seq: 43, sessionId: "ses_1", type: "memory.retention_succeeded", at: "later", data: { runId: "run_1", status: "succeeded" } }; });
 const response = await GET(req("&sinceSeq=41"), ctx); expect(response.headers.get("content-type")).toBe("text/event-stream"); const text = await response.text(); expect(text).toContain("id: 42\nevent: memory.recall"); expect(text).toContain('"_seq":43'); expect(m.subscribe).toHaveBeenCalledWith("ses_1", { sinceSeq: 41, signal: expect.any(AbortSignal) }); expect(m.run).toHaveBeenCalledWith({ runId: "run_1", userId });
});
