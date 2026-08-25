import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  wsFindOne: vi.fn(),
  usageAggregate: vi.fn(),
  projFind: vi.fn(),
  taskFind: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { findOne: mocks.wsFindOne } }));
vi.mock("@/models/workspace-usage-event", () => ({ WorkspaceUsageEventModel: { aggregate: mocks.usageAggregate } }));
vi.mock("@/models/project", () => ({ ProjectModel: { find: mocks.projFind } }));
vi.mock("@/models/task", () => ({ TaskModel: { find: mocks.taskFind } }));

import { GET } from "@/app/api/workspaces/[workspaceId]/usage/route";

const ctx = (workspaceId = "ws_1") => ({ params: Promise.resolve({ workspaceId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ workspaceId: "ws_1" }) }) });
  mocks.usageAggregate.mockReturnValue(Promise.resolve([]));
  mocks.projFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
  mocks.taskFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
});

describe("GET /api/workspaces/[workspaceId]/usage", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/workspaces/ws_1/usage"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when workspace not found", async () => {
    mocks.wsFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    const res = await GET(new NextRequest("http://localhost/api/workspaces/ws_1/usage"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns empty usage data when no events exist", async () => {
    mocks.usageAggregate.mockReturnValue(Promise.resolve([]));
    const res = await GET(new NextRequest("http://localhost/api/workspaces/ws_1/usage"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, eventCount: 0 });
    expect(body.daily).toEqual([]);
    expect(body.byProject).toEqual([]);
  });

  it("returns summary, daily, and byProject data", async () => {
    // First call: summary aggregate
    // Second call: daily aggregate
    // Third call: per-task aggregate
    mocks.usageAggregate
      .mockReturnValueOnce(Promise.resolve([{ inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 1000, totalTokens: 8000, eventCount: 10 }]))
      .mockReturnValueOnce(Promise.resolve([{ date: "2026-08-20", inputTokens: 3000, outputTokens: 1500, cacheReadTokens: 500, totalTokens: 5000 }, { date: "2026-08-21", inputTokens: 2000, outputTokens: 500, cacheReadTokens: 500, totalTokens: 3000 }]))
      .mockReturnValueOnce(Promise.resolve([{ _id: "task_1", inputTokens: 5000, outputTokens: 2000, cacheReadTokens: 1000, totalTokens: 8000 }]));
    mocks.taskFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ taskId: "task_1", projectId: "proj_1", title: "Test" }]) }) });
    mocks.projFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ projectId: "proj_1", name: "My Project" }]) }) });

    const res = await GET(new NextRequest("http://localhost/api/workspaces/ws_1/usage"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary.totalTokens).toBe(8000);
    expect(body.summary.eventCount).toBe(10);
    expect(body.daily).toHaveLength(2);
    expect(body.daily[0].date).toBe("2026-08-20");
    expect(body.byProject).toHaveLength(1);
    expect(body.byProject[0].projectName).toBe("My Project");
    expect(body.byProject[0].totalTokens).toBe(8000);
  });

  it("handles tasks without project assignment", async () => {
    mocks.usageAggregate
      .mockReturnValueOnce(Promise.resolve([{ inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, totalTokens: 150, eventCount: 2 }]))
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce(Promise.resolve([{ _id: "task_no_proj", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, totalTokens: 150 }]));
    mocks.taskFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ taskId: "task_no_proj", projectId: null, title: "No Project Task" }]) }) });

    const res = await GET(new NextRequest("http://localhost/api/workspaces/ws_1/usage"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.byProject).toHaveLength(1);
    expect(body.byProject[0].projectName).toBe("未分配项目");
  });
});
