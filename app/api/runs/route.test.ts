import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  runFind: vi.fn(),
  runCountDocuments: vi.fn(),
  taskFind: vi.fn(),
  wsFindOne: vi.fn(),
  wsFind: vi.fn(),
  usageAggregate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/run", () => ({ RunModel: { find: mocks.runFind, countDocuments: mocks.runCountDocuments } }));
vi.mock("@/models/task", () => ({ TaskModel: { find: mocks.taskFind } }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { findOne: mocks.wsFindOne, find: mocks.wsFind } }));
vi.mock("@/models/workspace-usage-event", () => ({ WorkspaceUsageEventModel: { aggregate: mocks.usageAggregate } }));

import { GET } from "@/app/api/runs/route";

function mockChain(result: unknown) {
  return { sort: vi.fn().mockReturnValue({ skip: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) }) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.runFind.mockReturnValue(mockChain([]));
  mocks.runCountDocuments.mockResolvedValue(0);
  mocks.taskFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
  mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ workspaceId: "ws_1" }) }) });
  mocks.wsFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
  mocks.usageAggregate.mockReturnValue(Promise.resolve([]));
});

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/runs${query ? `?${query}` : ""}`);
}

describe("GET /api/runs", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns empty list when no runs exist", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns enriched runs with task titles and usage", async () => {
    const runRecord = { runId: "run_1", taskId: "task_1", workspaceId: "ws_1", userId: "user_1", sessionId: "ses_1", status: "succeeded", attempt: 1, terminalReason: null, startedAt: "2026-08-24T10:00:00Z", finishedAt: "2026-08-24T10:05:00Z", createdAt: "2026-08-24T09:59:00Z", parentRunId: null, resumeCheckpointId: null, latestCheckpointId: null, active: false, budgetReserved: false, workspaceBudgetReserved: false };
    mocks.runFind.mockReturnValue(mockChain([runRecord]));
    mocks.runCountDocuments.mockResolvedValue(1);
    mocks.taskFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ taskId: "task_1", title: "Test Task", projectId: "proj_1" }]) }) });
    mocks.wsFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ workspaceId: "ws_1", name: "My WS" }]) }) });
    mocks.usageAggregate.mockReturnValue(Promise.resolve([{ _id: "run_1", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, totalTokens: 1700 }]));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].runId).toBe("run_1");
    expect(body.runs[0].taskTitle).toBe("Test Task");
    expect(body.runs[0].workspaceName).toBe("My WS");
    expect(body.runs[0].usage.totalTokens).toBe(1700);
    expect(body.runs[0].duration).toBe(300); // 5 minutes
    expect(body.total).toBe(1);
  });

  it("passes workspace filter to query", async () => {
    mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ workspaceId: "ws_1" }) }) });

    const res = await GET(makeRequest("workspaceId=ws_1"));
    expect(res.status).toBe(200);
    expect(mocks.runFind).toHaveBeenCalled();
  });

  it("returns empty when workspace not found", async () => {
    mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });

    const res = await GET(makeRequest("workspaceId=ws_missing"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([]);
    expect(body.total).toBe(0);
  });
});
