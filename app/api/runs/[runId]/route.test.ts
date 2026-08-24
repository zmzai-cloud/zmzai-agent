import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  runFindOne: vi.fn(),
  taskFindOne: vi.fn(),
  wsFindOne: vi.fn(),
  usageAggregate: vi.fn(),
  readEvents: vi.fn(),
  getMessages: vi.fn(),
  subagentFind: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/run", () => ({ RunModel: { findOne: mocks.runFindOne } }));
vi.mock("@/models/task", () => ({ TaskModel: { findOne: mocks.taskFindOne } }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { findOne: mocks.wsFindOne } }));
vi.mock("@/models/workspace-usage-event", () => ({ WorkspaceUsageEventModel: { aggregate: mocks.usageAggregate } }));
vi.mock("@/framework/core/runtime/runner", () => ({ defaultStore: { getMessages: mocks.getMessages } }));
vi.mock("@/framework/core/events/bus", () => ({ readFrameworkEvents: mocks.readEvents }));
vi.mock("@/models/subagent-run", () => ({ SubagentRunModel: { find: mocks.subagentFind } }));

import { GET } from "@/app/api/runs/[runId]/route";

const ctx = (runId = "run_1") => ({ params: Promise.resolve({ runId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.runFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  mocks.taskFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
  mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
  mocks.usageAggregate.mockReturnValue(Promise.resolve([]));
  mocks.readEvents.mockResolvedValue([]);
  mocks.getMessages.mockResolvedValue([]);
  mocks.subagentFind.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
});

describe("GET /api/runs/[runId]", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/runs/run_1"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when run not found", async () => {
    mocks.runFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    const res = await GET(new Request("http://localhost/api/runs/run_missing"), ctx("run_missing"));
    expect(res.status).toBe(404);
  });

  it("returns run detail with empty session data", async () => {
    const runRecord = { runId: "run_1", taskId: "task_1", workspaceId: "ws_1", userId: "user_1", sessionId: "ses_1", status: "succeeded", attempt: 1, terminalReason: null, startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:02:00Z", createdAt: "2026-08-24T09:59:00Z", parentRunId: null, resumeCheckpointId: null, latestCheckpointId: null, active: false, budgetReserved: false, workspaceBudgetReserved: false };
    mocks.runFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(runRecord) });
    mocks.taskFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ taskId: "task_1", title: "My Task", projectId: null }) }) });
    mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ workspaceId: "ws_1", name: "Test WS" }) }) });

    const res = await GET(new Request("http://localhost/api/runs/run_1"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.runId).toBe("run_1");
    expect(body.run.taskTitle).toBe("My Task");
    expect(body.run.workspaceName).toBe("Test WS");
    expect(body.run.duration).toBe(120);
    expect(body.toolTimeline).toEqual([]);
    expect(body.events).toEqual([]);
    expect(body.subagents).toEqual([]);
  });

  it("builds tool timeline from session messages", async () => {
    const runRecord = { runId: "run_1", taskId: "task_1", workspaceId: "ws_1", userId: "user_1", sessionId: "ses_1", status: "succeeded", attempt: 1, terminalReason: null, startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:02:00Z", createdAt: "2026-08-24T09:59:00Z", parentRunId: null, resumeCheckpointId: null, latestCheckpointId: null, active: false, budgetReserved: false, workspaceBudgetReserved: false };
    mocks.runFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(runRecord) });
    mocks.taskFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ taskId: "task_1", title: "Task", projectId: null }) }) });
    mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ workspaceId: "ws_1", name: "WS" }) }) });
    mocks.getMessages.mockResolvedValue([
      { info: { id: "msg_1", sessionId: "ses_1", role: "user", agent: "default", model: { providerId: "relay", modelId: "kimi-k3" }, time: { created: "2026-08-24T10:00:00Z" } }, parts: [] },
      {
        info: { id: "msg_2", sessionId: "ses_1", role: "assistant", parentId: "msg_1", agent: "default", model: { providerId: "relay", modelId: "kimi-k3" }, time: { created: "2026-08-24T10:00:01Z" } },
        parts: [{ id: "prt_1", type: "tool", callId: "call_1", tool: "read_file", state: { status: "completed", title: "Read config", output: "{}", time: { start: "2026-08-24T10:00:02Z", end: "2026-08-24T10:00:03Z" } } }],
      },
    ]);

    const res = await GET(new Request("http://localhost/api/runs/run_1"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.toolTimeline).toHaveLength(1);
    expect(body.toolTimeline[0].tool).toBe("read_file");
    expect(body.toolTimeline[0].status).toBe("completed");
  });

  it("returns usage data from aggregate", async () => {
    const runRecord = { runId: "run_1", taskId: "task_1", workspaceId: "ws_1", userId: "user_1", sessionId: "ses_1", status: "failed", attempt: 2, terminalReason: "timeout", startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:10:00Z", createdAt: "2026-08-24T09:59:00Z", parentRunId: null, resumeCheckpointId: null, latestCheckpointId: null, active: false, budgetReserved: false, workspaceBudgetReserved: false };
    mocks.runFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(runRecord) });
    mocks.taskFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ taskId: "task_1", title: "Task", projectId: null }) }) });
    mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ workspaceId: "ws_1", name: "WS" }) }) });
    mocks.usageAggregate.mockReturnValue(Promise.resolve([{ _id: null, inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 1000, cacheWriteTokens: 500, totalTokens: 8500, eventCount: 3 }]));

    const res = await GET(new Request("http://localhost/api/runs/run_1"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.status).toBe("failed");
    expect(body.run.terminalReason).toBe("timeout");
    expect(body.usage.totalTokens).toBe(8500);
    expect(body.usage.eventCount).toBe(3);
  });
});
