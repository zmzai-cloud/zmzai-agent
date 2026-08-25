import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  findOne: vi.fn(),
  getProjectAccess: vi.fn(),
  canEditProject: vi.fn(),
  generateSecret: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/automation-webhook", () => ({
  generateAutomationWebhookSecret: mocks.generateSecret,
}));
vi.mock("@/lib/project-access", () => ({
  getProjectAccess: mocks.getProjectAccess,
  canEditProject: mocks.canEditProject,
}));
vi.mock("@/models/automation", () => ({ AutomationModel: { findOne: mocks.findOne, updateOne: mocks.updateOne } }));

import { POST } from "@/app/api/automations/[automationId]/webhook-secret/route";

const ctx = (automationId = "aut_1") => ({ params: Promise.resolve({ automationId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("POST /api/automations/.../webhook-secret", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when automation is not found", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    const res = await POST(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns 404 when non-owner has no project access", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "aut_1", userId: "user_2", projectId: "proj_1" }) });
    mocks.getProjectAccess.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("generates secret for automation owner (no project)", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "aut_1", userId: "user_1", projectId: null }) });
    mocks.generateSecret.mockReturnValue({ encrypted: "enc_secret", plaintext: "whsec_abc", prefix: "whsec_" });
    const res = await POST(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toBe("whsec_abc");
    expect(body.prefix).toBe("whsec_");
    expect(body.url).toContain("/api/v1/automations/aut_1/webhook");
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { automationId: "aut_1" },
      { $set: { webhookSecret: "enc_secret", webhookSecretPrefix: "whsec_" } },
    );
  });

  it("allows project editor to generate secret", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "aut_1", userId: "user_2", projectId: "proj_1" }) });
    mocks.getProjectAccess.mockResolvedValue({ role: "editor" });
    mocks.canEditProject.mockReturnValue(true);
    mocks.generateSecret.mockReturnValue({ encrypted: "enc", plaintext: "whsec_xy", prefix: "whsec_" });
    const res = await POST(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
  });
});
