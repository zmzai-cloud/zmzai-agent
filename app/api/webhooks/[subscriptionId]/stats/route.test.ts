import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  exists: vi.fn(),
  countDocuments: vi.fn(),
  find: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/webhook-subscription", () => ({ WebhookSubscriptionModel: { exists: mocks.exists } }));
vi.mock("@/models/webhook-delivery", () => ({
  WebhookDeliveryModel: {
    countDocuments: mocks.countDocuments,
    find: mocks.find,
  },
}));

import { GET } from "@/app/api/webhooks/[subscriptionId]/stats/route";

const ctx = (subscriptionId = "sub_1") => ({
  params: Promise.resolve({ subscriptionId }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.exists.mockResolvedValue(true);
});

describe("GET /api/webhooks/.../stats", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when webhook does not belong to user", async () => {
    mocks.exists.mockResolvedValue(false);
    const res = await GET(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns stats with all counts", async () => {
    // countDocuments is called 4 times: delivered, pending, failed, total
    mocks.countDocuments
      .mockResolvedValueOnce(10) // delivered
      .mockResolvedValueOnce(2)  // pending
      .mockResolvedValueOnce(3)  // failed
      .mockResolvedValueOnce(15); // total
    mocks.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([
              { status: "delivered" },
              { status: "failed" },
              { status: "failed" },
            ]),
          }),
        }),
      }),
    });

    const res = await GET(new NextRequest("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      delivered: 10,
      pending: 2,
      failed: 3,
      total: 15,
      consecutiveFailures: 0, // first is delivered → breaks immediately
    });
  });

  it("counts consecutive failures from most recent", async () => {
    mocks.countDocuments
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(13);
    mocks.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([
              { status: "failed" },
              { status: "failed" },
              { status: "failed" },
              { status: "delivered" },
              { status: "failed" },
            ]),
          }),
        }),
      }),
    });

    const res = await GET(new NextRequest("http://localhost"), ctx());
    const body = await res.json();
    expect(body.consecutiveFailures).toBe(3);
  });

  it("returns 0 consecutiveFailures when no recent deliveries", async () => {
    mocks.countDocuments
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    mocks.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const res = await GET(new NextRequest("http://localhost"), ctx());
    const body = await res.json();
    expect(body.consecutiveFailures).toBe(0);
    expect(body.total).toBe(0);
  });
});
