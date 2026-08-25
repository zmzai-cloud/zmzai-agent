import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getArtifactAccess: vi.fn(),
  canEditProject: vi.fn(),
  findOneAndUpdate: vi.fn(),
  deleteOne: vi.fn(),
  deleteMany: vi.fn(),
  deleteArtifactFiles: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/artifact-access", () => ({ getArtifactAccess: mocks.getArtifactAccess }));
vi.mock("@/lib/project-access", () => ({ canEditProject: mocks.canEditProject }));
vi.mock("@/lib/artifact-storage", () => ({ deleteArtifactFiles: mocks.deleteArtifactFiles }));
vi.mock("@/models/sandbox-artifact", () => ({ SandboxArtifactModel: { findOneAndUpdate: mocks.findOneAndUpdate, deleteOne: mocks.deleteOne } }));
vi.mock("@/models/project-artifact", () => ({ ProjectArtifactModel: { deleteMany: mocks.deleteMany } }));

import { PATCH, DELETE } from "@/app/api/artifacts/[artifactId]/route";

const ctx = (artifactId = "art_1") => ({ params: Promise.resolve({ artifactId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.canEditProject.mockReturnValue(true);
  mocks.deleteArtifactFiles.mockResolvedValue(undefined);
  mocks.deleteMany.mockResolvedValue({ deletedCount: 0 });
});

describe("PATCH /api/artifacts/[artifactId]", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: "{}" }), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "" }) }), ctx());
    expect(res.status).toBe(400);
  });

  it("returns 404 when artifact access is denied", async () => {
    mocks.getArtifactAccess.mockResolvedValue(null);
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "New" }) }), ctx());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user cannot edit project", async () => {
    mocks.getArtifactAccess.mockResolvedValue({ artifact: { artifactId: "art_1" }, access: { role: "viewer" } });
    mocks.canEditProject.mockReturnValue(false);
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "New" }) }), ctx());
    expect(res.status).toBe(403);
  });

  it("updates artifact title", async () => {
    mocks.getArtifactAccess.mockResolvedValue({ artifact: { artifactId: "art_1" }, access: { role: "owner" } });
    mocks.findOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue({ artifactId: "art_1", title: "Updated" }) });
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "Updated" }) }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifact.title).toBe("Updated");
  });
});

describe("DELETE /api/artifacts/[artifactId]", () => {
  it("returns 404 when artifact access is denied", async () => {
    mocks.getArtifactAccess.mockResolvedValue(null);
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("deletes artifact with gridFs files", async () => {
    mocks.getArtifactAccess.mockResolvedValue({ artifact: { artifactId: "art_1", gridFsFileId: "fs_123" }, access: { role: "owner" } });
    mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    expect(mocks.deleteArtifactFiles).toHaveBeenCalledWith(["fs_123"]);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ artifactId: "art_1" });
  });

  it("deletes artifact without gridFs files", async () => {
    mocks.getArtifactAccess.mockResolvedValue({ artifact: { artifactId: "art_1", gridFsFileId: null }, access: { role: "owner" } });
    mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    expect(mocks.deleteArtifactFiles).not.toHaveBeenCalled();
  });

  it("returns 404 when deleteOne finds nothing", async () => {
    mocks.getArtifactAccess.mockResolvedValue({ artifact: { artifactId: "art_1", gridFsFileId: null }, access: { role: "owner" } });
    mocks.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });
});
