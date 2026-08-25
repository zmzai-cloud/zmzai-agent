import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  findOneAndUpdate: vi.fn(),
  deleteOne: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/webhook-subscription", () => ({
  WebhookSubscriptionModel: {
    findOneAndUpdate: mocks.findOneAndUpdate,
    deleteOne: mocks.deleteOne,
  },
}));

import { PATCH, DELETE } from "@/app/api/webhooks/[subscriptionId]/route";

const ctx = (subscriptionId = "whs_1") => ({ params: Promise.resolve({ subscriptionId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("PATCH /api/webhooks/[subscriptionId]", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: "{}" }), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "invalid" }) }), ctx());
    expect(res.status).toBe(400);
  });

  it("returns 404 when webhook not found", async () => {
    mocks.findOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "paused" }) }), ctx());
    expect(res.status).toBe(404);
  });

  it("updates webhook status", async () => {
    const now = new Date();
    mocks.findOneAndUpdate.mockReturnValue({ lean: vi.fn().mockResolvedValue({ subscriptionId: "whs_1", workspaceId: "ws_1", name: "Hook", url: "https://example.com", events: ["task.completed"], status: "paused", secretPrefix: "whsec_", lastDeliveredAt: null, lastError: null, createdAt: now }) });
    const res = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "paused" }) }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription.status).toBe("paused");
  });
});

describe("DELETE /api/webhooks/[subscriptionId]", () => {
  it("returns 404 when webhook not found", async () => {
    mocks.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("deletes a webhook subscription", async () => {
    mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const res = await DELETE(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });
});
