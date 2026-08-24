import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  exists: vi.fn(),
  find: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/webhook-subscription", () => ({ WebhookSubscriptionModel: { exists: mocks.exists } }));
vi.mock("@/models/webhook-delivery", () => ({ WebhookDeliveryModel: { find: mocks.find } }));

import { GET } from "@/app/api/webhooks/[subscriptionId]/deliveries/route";

const ctx = (subscriptionId = "whs_1") => ({ params: Promise.resolve({ subscriptionId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.exists.mockResolvedValue(true);
});

describe("GET /api/webhooks/.../deliveries", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when webhook not found", async () => {
    mocks.exists.mockResolvedValue(false);
    const res = await GET(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns deliveries list", async () => {
    const deliveries = [
      { deliveryId: "del_1", eventType: "task.completed", taskId: "task_1", runId: "run_1", status: "delivered", attempts: 1, nextAttemptAt: null, responseStatus: 200, lastError: null, deliveredAt: new Date(), createdAt: new Date() },
      { deliveryId: "del_2", eventType: "task.failed", taskId: "task_2", runId: "run_2", status: "failed", attempts: 3, nextAttemptAt: new Date(), responseStatus: null, lastError: "timeout", deliveredAt: null, createdAt: new Date() },
    ];
    mocks.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(deliveries),
          }),
        }),
      }),
    });
    const res = await GET(new Request("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toHaveLength(2);
    expect(body.deliveries[0].deliveryId).toBe("del_1");
    expect(body.deliveries[1].status).toBe("failed");
  });

  it("returns empty deliveries when none exist", async () => {
    mocks.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) }) });
    const res = await GET(new Request("http://localhost"), ctx());
    const body = await res.json();
    expect(body.deliveries).toEqual([]);
  });
});
