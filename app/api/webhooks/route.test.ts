import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  getWorkspace: vi.fn(),
  generateSecret: vi.fn(),
  normalizeUrl: vi.fn(),
  assertPublic: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/outbound-webhooks", () => ({
  outboundWebhookEvents: ["task.completed", "task.failed"],
  generateOutboundWebhookSecret: mocks.generateSecret,
}));
vi.mock("@/lib/workspace-connectors", () => ({
  normalizeConnectorUrl: mocks.normalizeUrl,
  assertPublicConnectorTarget: mocks.assertPublic,
}));
vi.mock("@/lib/workspaces", () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock("@/models/webhook-subscription", () => ({ WebhookSubscriptionModel: { find: mocks.find, create: mocks.create } }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: mocks.randomUUID };
});

import { GET, POST } from "@/app/api/webhooks/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.normalizeUrl.mockImplementation((url: string) => url);
  mocks.assertPublic.mockResolvedValue(undefined);
  mocks.randomUUID.mockReturnValue("12345678-1234-1234-1234-123456789abc");
});

describe("GET /api/webhooks", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/webhooks") as any);
    expect(res.status).toBe(401);
  });

  it("returns subscriptions list", async () => {
    const now = new Date();
    mocks.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { subscriptionId: "whs_1", workspaceId: "ws_1", name: "My Hook", url: "https://example.com/hook", events: ["task.completed"], status: "active", secretPrefix: "whsec_", lastDeliveredAt: null, lastError: null, createdAt: now },
          ]),
        }),
      }),
    });
    const res = await GET(new NextRequest("http://localhost/api/webhooks") as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscriptions).toHaveLength(1);
    expect(body.subscriptions[0].id).toBe("whs_1");
  });

  it("filters by workspaceId", async () => {
    mocks.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) });
    await GET(new NextRequest("http://localhost/api/webhooks?workspaceId=ws_1") as any);
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws_1" }));
  });
});

describe("POST /api/webhooks", () => {
  it("returns 400 for invalid body", async () => {
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ name: "" }) }) as any);
    expect(res.status).toBe(400);
  });

  it("returns 404 when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_bad", name: "Hook", url: "https://example.com", events: ["task.completed"] }) }) as any);
    expect(res.status).toBe(404);
  });

  it("returns 400 when URL is not valid", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    mocks.normalizeUrl.mockReturnValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_1", name: "Hook", url: "http://bad", events: ["task.completed"] }) }) as any);
    expect(res.status).toBe(400);
  });

  it("returns 422 when URL is not publicly accessible", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    mocks.assertPublic.mockRejectedValue(new Error("Host is not publicly accessible"));
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_1", name: "Hook", url: "https://example.com", events: ["task.completed"] }) }) as any);
    expect(res.status).toBe(422);
  });

  it("creates a webhook subscription", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    const now = new Date();
    mocks.generateSecret.mockReturnValue({ encrypted: "enc", plaintext: "whsec_secret", prefix: "whsec_" });
    mocks.create.mockResolvedValue({ subscriptionId: "whs_new", workspaceId: "ws_1", name: "Hook", url: "https://example.com", events: ["task.completed"], status: "active", secretPrefix: "whsec_", lastDeliveredAt: null, lastError: null, createdAt: now });
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_1", name: "Hook", url: "https://example.com", events: ["task.completed"] }) }) as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.subscription.id).toBe("whs_new");
    expect(body.secret).toBe("whsec_secret");
  });
});
