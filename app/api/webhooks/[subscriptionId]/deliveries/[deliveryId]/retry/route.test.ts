import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  exists: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/webhook-subscription", () => ({ WebhookSubscriptionModel: { exists: mocks.exists } }));
vi.mock("@/models/webhook-delivery", () => ({
  WebhookDeliveryModel: {
    findOne: mocks.findOne,
    updateOne: mocks.updateOne,
  },
}));

import { POST } from "@/app/api/webhooks/[subscriptionId]/deliveries/[deliveryId]/retry/route";

const ctx = (subscriptionId = "sub_1", deliveryId = "del_1") => ({
  params: Promise.resolve({ subscriptionId, deliveryId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.exists.mockResolvedValue(true);
  mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("POST /api/webhooks/.../retry", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when webhook does not belong to user", async () => {
    mocks.exists.mockResolvedValue(false);
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("WEBHOOK_NOT_FOUND");
  });

  it("returns 404 when delivery is not found", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("DELIVERY_NOT_FOUND");
  });

  it("returns 422 when delivery is not failed", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ deliveryId: "del_1", status: "delivered" }) });
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("DELIVERY_NOT_RETRYABLE");
  });

  it("resets a failed delivery to pending", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ deliveryId: "del_1", status: "failed", attempts: 3 }) });
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deliveryId: "del_1", status: "pending" });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { deliveryId: "del_1" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "pending", attempts: 0 }) }),
    );
  });

  it("allows retrying a delivery with status 'failed' regardless of attempts count", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ deliveryId: "del_1", status: "failed", attempts: 0 }) });
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(200);
  });
});
