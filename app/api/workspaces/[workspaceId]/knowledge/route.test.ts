import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getWorkspace: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/workspaces", () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock("@/models/workspace", () => ({
  WorkspaceModel: {
    findOne: mocks.findOne,
    updateOne: mocks.updateOne,
  },
}));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: mocks.randomUUID };
});

import { DELETE, GET, POST, PUT } from "@/app/api/workspaces/[workspaceId]/knowledge/route";

const ctx = (workspaceId = "ws_1") => ({
  params: Promise.resolve({ workspaceId }),
});

function nextReq(url = "http://localhost/api/workspaces/ws_1/knowledge", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
  mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
  mocks.randomUUID.mockReturnValue("12345678-1234-1234-1234-123456789abc");
});

describe("GET /api/workspaces/.../knowledge", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(nextReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when workspace not found", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const res = await GET(nextReq(), ctx());
    expect(res.status).toBe(404);
  });

  it("returns knowledgeBase entries", async () => {
    const entries = [{ entryId: "kb_1", title: "API Spec", content: "REST guidelines" }];
    mocks.findOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ knowledgeBase: entries }) }) });
    const res = await GET(nextReq(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.knowledgeBase).toEqual(entries);
  });

  it("returns empty array when workspace has no knowledgeBase", async () => {
    mocks.findOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    const res = await GET(nextReq(), ctx());
    const body = await res.json();
    expect(body.knowledgeBase).toEqual([]);
  });
});

describe("POST /api/workspaces/.../knowledge", () => {
  it("returns 400 for invalid body", async () => {
    const res = await POST(nextReq("http://localhost", { method: "POST", body: JSON.stringify({ title: "" }), headers: { "content-type": "application/json" } }), ctx());
    expect(res.status).toBe(400);
  });

  it("creates a knowledge entry", async () => {
    const res = await POST(
      nextReq("http://localhost", {
        method: "POST",
        body: JSON.stringify({ title: "Coding Standards", content: "Use TypeScript strict mode" }),
        headers: { "content-type": "application/json" },
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry).toEqual({
      entryId: "kb_1234567812341234",
      title: "Coding Standards",
      content: "Use TypeScript strict mode",
    });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { workspaceId: "ws_1", userId: "user_1" },
      { $push: { knowledgeBase: body.entry } },
    );
  });
});

describe("PUT /api/workspaces/.../knowledge", () => {
  it("returns 400 for missing entryId", async () => {
    const res = await PUT(
      nextReq("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ title: "Updated" }),
        headers: { "content-type": "application/json" },
      }),
      ctx(),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when entry does not exist", async () => {
    mocks.findOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ knowledgeBase: [] }) }) });
    const res = await PUT(
      nextReq("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ entryId: "kb_nonexistent", title: "Updated" }),
        headers: { "content-type": "application/json" },
      }),
      ctx(),
    );
    expect(res.status).toBe(404);
  });

  it("updates an existing entry", async () => {
    const entries = [{ entryId: "kb_abc", title: "Old Title", content: "Old Content" }];
    mocks.findOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ knowledgeBase: entries }) }) });
    const res = await PUT(
      nextReq("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ entryId: "kb_abc", title: "New Title" }),
        headers: { "content-type": "application/json" },
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.title).toBe("New Title");
    expect(body.entry.content).toBe("Old Content"); // unchanged
  });
});

describe("DELETE /api/workspaces/.../knowledge", () => {
  it("returns 400 when entryId is missing", async () => {
    const res = await DELETE(nextReq("http://localhost/api/workspaces/ws_1/knowledge", { method: "DELETE" }), ctx());
    expect(res.status).toBe(400);
  });

  it("deletes an entry by entryId", async () => {
    const res = await DELETE(nextReq("http://localhost/api/workspaces/ws_1/knowledge?entryId=kb_abc", { method: "DELETE" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { workspaceId: "ws_1", userId: "user_1" },
      { $pull: { knowledgeBase: { entryId: "kb_abc" } } },
    );
  });
});
