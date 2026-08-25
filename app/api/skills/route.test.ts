import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  workspaceFind: vi.fn(),
  skillFind: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { find: mocks.workspaceFind } }));
vi.mock("@/models/workspace-skill", () => ({ WorkspaceSkillModel: { find: mocks.skillFind } }));

import { GET } from "@/app/api/skills/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("GET /api/skills", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/skills"));
    expect(res.status).toBe(401);
  });

  it("returns skills across all workspaces", async () => {
    mocks.workspaceFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ workspaceId: "ws_1", name: "My WS" }]) }) });
    mocks.skillFind.mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ skillId: "sk_1", name: "test-skill", description: "A test", repository: "user/repo", requestedRef: "main", commitSha: "abc", path: "skills/test", workspaceId: "ws_1", markdown: "# Test", createdAt: new Date() }]) }) }) });

    const res = await GET(new NextRequest("http://localhost/api/skills"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(1);
    expect(body.skills[0].name).toBe("test-skill");
    expect(body.skills[0].workspaceName).toBe("My WS");
  });

  it("filters by workspaceId", async () => {
    mocks.workspaceFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ workspaceId: "ws_1", name: "WS1" }, { workspaceId: "ws_2", name: "WS2" }]) }) });
    mocks.skillFind.mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) });

    await GET(new NextRequest("http://localhost/api/skills?workspaceId=ws_1"));
    expect(mocks.skillFind).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: { $in: ["ws_1"] } }));
  });

  it("returns empty skills when no workspaces exist", async () => {
    mocks.workspaceFind.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
    const res = await GET(new NextRequest("http://localhost/api/skills"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toHaveLength(0);
  });
});
