import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getArtifactAccess: vi.fn(),
  getProjectAccess: vi.fn(),
  canEditProject: vi.fn(),
  projectFindOne: vi.fn(),
  projectArtifactFindOneAndUpdate: vi.fn(),
  projectArtifactDeleteOne: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/project-access", () => ({
  getProjectAccess: mocks.getProjectAccess,
  canEditProject: mocks.canEditProject,
}));
vi.mock("@/lib/artifact-access", () => ({ getArtifactAccess: mocks.getArtifactAccess }));
vi.mock("@/models/project-artifact", () => ({
  ProjectArtifactModel: {
    findOneAndUpdate: mocks.projectArtifactFindOneAndUpdate,
    deleteOne: mocks.projectArtifactDeleteOne,
  },
}));
vi.mock("@/models/project", () => ({ ProjectModel: { findOne: mocks.projectFindOne } }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: mocks.randomUUID };
});

import { POST, DELETE } from "@/app/api/artifacts/[artifactId]/project/route";

const ctx = (artifactId = "art_1") => ({ params: Promise.resolve({ artifactId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.canEditProject.mockReturnValue(true);
  mocks.randomUUID.mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
});

describe("POST /api/artifacts/[artifactId]/project", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: "{}" }), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 400 when projectId is missing", async () => {
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({}) }), ctx());
    expect(res.status).toBe(400);
  });

  it("returns 404 when project does not exist", async () => {
    mocks.projectFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ projectId: "proj_bad" }) }), ctx());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user cannot edit project", async () => {
    mocks.projectFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ projectId: "proj_1", workspaceId: "ws_1", userId: "user_2" }) }) });
    mocks.getProjectAccess.mockResolvedValue({ role: "viewer", project: { projectId: "proj_1", workspaceId: "ws_1", userId: "user_2" } });
    mocks.canEditProject.mockReturnValue(false);
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ projectId: "proj_1" }) }), ctx());
    expect(res.status).toBe(403);
  });

  it("returns 404 when artifact does not exist", async () => {
    mocks.projectFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ projectId: "proj_1", workspaceId: "ws_1", userId: "user_1" }) }) });
    mocks.getProjectAccess.mockResolvedValue({ role: "owner", project: { projectId: "proj_1", workspaceId: "ws_1", userId: "user_1" } });
    mocks.getArtifactAccess.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ projectId: "proj_1" }) }), ctx());
    expect(res.status).toBe(404);
  });

  it("creates a project-artifact reference", async () => {
    mocks.projectFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ projectId: "proj_1", workspaceId: "ws_1", userId: "user_1" }) }) });
    mocks.getProjectAccess.mockResolvedValue({ role: "owner", project: { projectId: "proj_1", workspaceId: "ws_1", userId: "user_1" } });
    mocks.getArtifactAccess.mockResolvedValue({ artifact: { artifactId: "art_1", userId: "user_1" } });
    const reference = { referenceId: "par_aaaaaaaabbbbccccdddd", projectId: "proj_1", workspaceId: "ws_1", artifactId: "art_1", artifactOwnerId: "user_1", addedBy: "user_1" };
    mocks.projectArtifactFindOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue(reference) });
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ projectId: "proj_1" }) }), ctx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reference.projectId).toBe("proj_1");
    expect(body.reference.artifactId).toBe("art_1");
  });
});

describe("DELETE /api/artifacts/[artifactId]/project", () => {
  it("returns 404 when project access is denied", async () => {
    mocks.getProjectAccess.mockResolvedValue(null);
    const res = await DELETE(new NextRequest("http://localhost/api/artifacts/art_1/project?projectId=proj_1"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns 404 when reference does not exist", async () => {
    mocks.getProjectAccess.mockResolvedValue({ role: "owner" });
    mocks.projectArtifactDeleteOne.mockResolvedValue({ deletedCount: 0 });
    const res = await DELETE(new NextRequest("http://localhost/api/artifacts/art_1/project?projectId=proj_1"), ctx());
    expect(res.status).toBe(404);
  });

  it("deletes a project-artifact reference", async () => {
    mocks.getProjectAccess.mockResolvedValue({ role: "owner" });
    mocks.projectArtifactDeleteOne.mockResolvedValue({ deletedCount: 1 });
    const res = await DELETE(new NextRequest("http://localhost/api/artifacts/art_1/project?projectId=proj_1"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });
});
