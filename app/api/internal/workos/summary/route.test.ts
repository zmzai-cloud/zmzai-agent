import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getEnv: vi.fn(),
  taskFind: vi.fn(),
  workspaceFind: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getServerEnvironment: mocks.getEnv }));
vi.mock("@/lib/database/mongodb", () => ({ connectMongo: vi.fn() }));
vi.mock("@/models/task", () => ({ TaskModel: { find: mocks.taskFind } }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { find: mocks.workspaceFind } }));

import { GET } from "@/app/api/internal/workos/summary/route";

const USER_ID = "507f1f77bcf86cd799439011";
const SECRET_CURRENT = "workos-service-secret-current-0123456789ab";
const SECRET_PREVIOUS = "workos-service-secret-previous-0123456789ab";

function findChain(result: unknown[]) {
  const chain = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEnv.mockReturnValue({ WORKOS_SERVICE_SECRET_CURRENT: SECRET_CURRENT, WORKOS_SERVICE_SECRET_PREVIOUS: undefined });
});

describe("GET /api/internal/workos/summary", () => {
  it("returns 401 without a valid bearer secret", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/internal/workos/summary?userId=${USER_ID}`));
    expect(res.status).toBe(401);
  });

  it("accepts the PREVIOUS secret during rotation", async () => {
    mocks.getEnv.mockReturnValue({ WORKOS_SERVICE_SECRET_CURRENT: SECRET_CURRENT, WORKOS_SERVICE_SECRET_PREVIOUS: SECRET_PREVIOUS });
    mocks.taskFind.mockReturnValue(findChain([]));
    mocks.workspaceFind.mockReturnValue(findChain([]));
    const res = await GET(
      new NextRequest(`http://localhost/api/internal/workos/summary?userId=${USER_ID}`, {
        headers: { authorization: `Bearer ${SECRET_PREVIOUS}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 400 for an invalid userId", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/workos/summary?userId=not-an-objectid", {
        headers: { authorization: `Bearer ${SECRET_CURRENT}` },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-positive-integer limit", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/internal/workos/summary?userId=${USER_ID}&taskLimit=abc`, {
        headers: { authorization: `Bearer ${SECRET_CURRENT}` },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns summary shape and clamps limits to 20", async () => {
    const updatedAt = new Date("2026-08-27T00:00:00.000Z");
    const taskChain = findChain([{ taskId: "task_1", title: "发布周报", status: "active", workspaceId: "ws_1", updatedAt }]);
    const workspaceChain = findChain([{ workspaceId: "ws_1", name: "写作智能体", description: "", knowledgeBase: [{ entryId: "e1" }, { entryId: "e2" }], updatedAt }]);
    mocks.taskFind.mockReturnValue(taskChain);
    mocks.workspaceFind.mockReturnValue(workspaceChain);

    const res = await GET(
      new NextRequest(`http://localhost/api/internal/workos/summary?userId=${USER_ID}&taskLimit=99&workspaceLimit=0`, {
        headers: { authorization: `Bearer ${SECRET_CURRENT}` },
      }),
    );
    expect(res.status).toBe(400); // workspaceLimit=0 非正整数 → 400

    const okRes = await GET(
      new NextRequest(`http://localhost/api/internal/workos/summary?userId=${USER_ID}&taskLimit=99`, {
        headers: { authorization: `Bearer ${SECRET_CURRENT}` },
      }),
    );
    expect(okRes.status).toBe(200);
    expect(taskChain.limit).toHaveBeenCalledWith(20); // 99 截断到 20
    const body = await okRes.json();
    expect(body.tasks[0]).toEqual({ taskId: "task_1", title: "发布周报", status: "active", workspaceId: "ws_1", updatedAt: "2026-08-27T00:00:00.000Z" });
    expect(body.workspaces[0].knowledgeCount).toBe(2);
    expect(okRes.headers.get("cache-control")).toBe("no-store");
  });

  it("defaults limit to 8 when omitted", async () => {
    const taskChain = findChain([]);
    const workspaceChain = findChain([]);
    mocks.taskFind.mockReturnValue(taskChain);
    mocks.workspaceFind.mockReturnValue(workspaceChain);
    const res = await GET(
      new NextRequest(`http://localhost/api/internal/workos/summary?userId=${USER_ID}`, {
        headers: { authorization: `Bearer ${SECRET_CURRENT}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(taskChain.limit).toHaveBeenCalledWith(8);
    expect(workspaceChain.limit).toHaveBeenCalledWith(8);
  });
});
