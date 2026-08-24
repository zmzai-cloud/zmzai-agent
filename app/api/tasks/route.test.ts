import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  memberFind: vi.fn(),
  taskFind: vi.fn(),
  runFind: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/project-member", () => ({
  ProjectMemberModel: { find: mocks.memberFind },
}));
vi.mock("@/models/task", () => ({
  TaskModel: { find: mocks.taskFind },
}));
vi.mock("@/models/run", () => ({
  RunModel: { find: mocks.runFind },
}));

import { GET } from "@/app/api/tasks/route";

function chainMock(data: unknown) {
  const sort = vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(data),
    }),
    lean: vi.fn().mockResolvedValue(data),
  });
  return { sort };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("GET /api/tasks", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/tasks") as any);
    expect(res.status).toBe(401);
  });

  it("returns empty tasks when user has no memberships", async () => {
    mocks.memberFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
    mocks.taskFind.mockReturnValue(chainMock([]));

    const res = await GET(new NextRequest("http://localhost/api/tasks") as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([]);
    // No projectIds → query only userId
    expect(mocks.taskFind).toHaveBeenCalledWith({ userId: "user_1" });
  });

  it("includes project tasks when user is a member", async () => {
    mocks.memberFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ projectId: "proj_1" }]) }) });
    const tasks = [{ taskId: "task_1", userId: "user_1", projectId: "proj_1", workspaceId: "ws_1", status: "completed" }];
    mocks.taskFind.mockReturnValue(chainMock(tasks));
    mocks.runFind.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });

    const res = await GET(new NextRequest("http://localhost/api/tasks") as any);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].task.taskId).toBe("task_1");
    expect(body.tasks[0].latestRun).toBeNull();
    // Query includes $or with projectId
    expect(mocks.taskFind).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array) }),
    );
  });

  it("attaches latestRun to each task", async () => {
    mocks.memberFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
    const tasks = [
      { taskId: "task_1", userId: "user_1", status: "completed" },
      { taskId: "task_2", userId: "user_1", status: "running" },
    ];
    mocks.taskFind.mockReturnValue(chainMock(tasks));
    const runs = [
      { runId: "run_old", taskId: "task_1", createdAt: "2025-01-01" },
      { runId: "run_new", taskId: "task_1", createdAt: "2025-01-02" },
      { runId: "run_3", taskId: "task_2", createdAt: "2025-01-03" },
    ];
    mocks.runFind.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(runs) }) });

    const res = await GET(new NextRequest("http://localhost/api/tasks") as any);
    const body = await res.json();
    // task_1 should get the first run in the sorted array (sort is -1, so first = latest)
    expect(body.tasks[0].latestRun.runId).toBe("run_old");
    expect(body.tasks[1].latestRun.runId).toBe("run_3");
  });

  it("applies workspaceId and status filters", async () => {
    mocks.memberFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
    mocks.taskFind.mockReturnValue(chainMock([]));

    const url = "http://localhost/api/tasks?workspaceId=ws_1&status=completed";
    await GET(new NextRequest(url) as any);

    expect(mocks.taskFind).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", status: "completed" }),
    );
  });
});
