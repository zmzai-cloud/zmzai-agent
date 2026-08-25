import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  taskFindOne: vi.fn(),
  shareDeleteMany: vi.fn(),
  shareCreate: vi.fn(),
  shareFindOne: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: () => ({ APP_URL: "http://localhost:3000" }) }));
vi.mock("@/models/task", () => ({ TaskModel: { findOne: mocks.taskFindOne } }));
vi.mock("@/models/task-share", () => ({ TaskShareModel: { deleteMany: mocks.shareDeleteMany, create: mocks.shareCreate, findOne: mocks.shareFindOne } }));

import { GET, POST, DELETE } from "@/app/api/tasks/[taskId]/share/route";

const ctx = (taskId = "task_1") => ({ params: Promise.resolve({ taskId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.taskFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ taskId: "task_1", userId: "user_1" }) }) });
  mocks.shareDeleteMany.mockResolvedValue({ deletedCount: 0 });
  mocks.shareCreate.mockResolvedValue({ shareId: "share_1" });
});

describe("POST /api/tasks/[taskId]/share", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST" }), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when task not found", async () => {
    mocks.taskFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    const res = await POST(new NextRequest("http://localhost", { method: "POST" }), ctx());
    expect(res.status).toBe(404);
  });

  it("creates a share link", async () => {
    const res = await POST(new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shareUrl).toContain("/share/t/");
    expect(body.expiresAt).toBeTruthy();
    expect(mocks.shareDeleteMany).toHaveBeenCalledWith({ taskId: "task_1" });
  });
});

describe("DELETE /api/tasks/[taskId]/share", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("revokes the share", async () => {
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(true);
    expect(mocks.shareDeleteMany).toHaveBeenCalledWith({ taskId: "task_1" });
  });
});

describe("GET /api/tasks/[taskId]/share", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns shared: false when no share exists", async () => {
    mocks.shareFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) }) });
    const res = await GET(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shared).toBe(false);
  });

  it("returns shared: true with expiry when share exists", async () => {
    const expiresAt = new Date("2026-09-01T00:00:00Z");
    mocks.shareFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ expiresAt, createdAt: new Date() }) }) }) });
    const res = await GET(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shared).toBe(true);
    expect(body.expiresAt).toBe("2026-09-01T00:00:00.000Z");
  });
});
