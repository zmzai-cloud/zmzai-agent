import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), getWorkspace: vi.fn(), updateWorkspace: vi.fn(), reviewed: vi.fn(), add: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({ unauthenticated: () => new Response("", { status: 401 }), apiError: (_code: string, status: number, message: string) => new Response(JSON.stringify({ error: message }), { status }) }));
vi.mock("@/lib/workspaces", () => ({ getWorkspace: mocks.getWorkspace, updateWorkspace: mocks.updateWorkspace }));
vi.mock("@/lib/github-skill-discovery", () => ({ reviewedGithubSkill: mocks.reviewed }));
vi.mock("@/lib/workspace-skills", () => ({ addImportedGithubWorkspaceSkill: mocks.add, listWorkspaceSkills: mocks.list }));

import { POST } from "@/app/api/workspaces/[workspaceId]/skills/route";

const context = { params: Promise.resolve({ workspaceId: "ws_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1", skillIds: [] });
  mocks.reviewed.mockReturnValue({ repository: "openai/skills", commitSha: "a".repeat(40), path: "skills/pdf" });
  mocks.add.mockResolvedValue({ skill: { id: "skl_1" }, reused: false });
});

describe("POST /api/workspaces/:workspaceId/skills", () => {
  it("refuses mutable GitHub coordinates without a reviewed token", async () => {
    const response = await POST(new NextRequest("http://localhost/api/workspaces/ws_1/skills", { method: "POST", body: JSON.stringify({ repository: "openai/skills", path: "skills/pdf" }) }), context);
    expect(response?.status).toBe(400);
    expect(mocks.reviewed).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("persists only the server-verified review payload", async () => {
    const response = await POST(new NextRequest("http://localhost/api/workspaces/ws_1/skills", { method: "POST", body: JSON.stringify({ reviewToken: "x".repeat(20), markdown: "# PDF" }) }), context);
    expect(response?.status).toBe(201);
    expect(mocks.reviewed).toHaveBeenCalledWith({ userId: "user_1", workspaceId: "ws_1", reviewToken: "x".repeat(20), markdown: "# PDF" });
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", workspaceId: "ws_1" }));
    expect(mocks.updateWorkspace).toHaveBeenCalledWith("user_1", "ws_1", { skillIds: ["skl_1"] });
  });
});
