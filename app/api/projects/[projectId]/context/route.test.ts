import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getProjectAccess: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/project-access", () => ({ canEditProject: vi.fn(() => true), getProjectAccess: mocks.getProjectAccess }));
vi.mock("@/models/project-context-item", () => ({ ProjectContextItemModel: { find: mocks.find, create: mocks.create } }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => "12345678-1234-1234-1234-123456789abc" };
});

import { GET, POST } from "@/app/api/projects/[projectId]/context/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("GET /api/projects/:projectId/context", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ projectId: "proj_1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when project access denied", async () => {
    mocks.getProjectAccess.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ projectId: "proj_bad" }) });
    expect(res.status).toBe(404);
  });

  it("returns context items", async () => {
    mocks.getProjectAccess.mockResolvedValue({ project: { userId: "user_1", workspaceId: "ws_1" } });
    mocks.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ contextId: "ctx_1", title: "API Spec", type: "note" }]) }) });
    const res = await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ projectId: "proj_1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contextItems).toHaveLength(1);
  });
});

describe("POST /api/projects/:projectId/context", () => {
  it("returns 400 for invalid body", async () => {
    mocks.getProjectAccess.mockResolvedValue({ project: { userId: "user_1", workspaceId: "ws_1" } });
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ type: "note", title: "" }) }), { params: Promise.resolve({ projectId: "proj_1" }) });
    expect(res.status).toBe(400);
  });

  it("creates a note context item", async () => {
    mocks.getProjectAccess.mockResolvedValue({ project: { userId: "user_1", workspaceId: "ws_1" } });
    mocks.create.mockResolvedValue({ contextId: "ctx_new", projectId: "proj_1", type: "note", title: "Test Note", content: "Hello" });
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ type: "note", title: "Test Note", content: "Hello" }) }), { params: Promise.resolve({ projectId: "proj_1" }) });
    expect(res.status).toBe(201);
  });
});
