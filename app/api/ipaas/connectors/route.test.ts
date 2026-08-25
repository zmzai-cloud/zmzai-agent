import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getWorkspace: vi.fn(),
  connectorFind: vi.fn(),
  connectorCreate: vi.fn(),
  isPlatformRegistered: vi.fn(),
  encryptConnectorHeaders: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/workspaces", () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock("@/lib/connector-secrets", () => ({ encryptConnectorHeaders: mocks.encryptConnectorHeaders }));
vi.mock("@/lib/ipaas/connector-registry", () => ({ isPlatformRegistered: mocks.isPlatformRegistered }));
vi.mock("@/models/ipaas-connector", () => ({ IpaasConnectorModel: { find: mocks.connectorFind, create: mocks.connectorCreate } }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: mocks.randomUUID };
});

import { GET, POST } from "@/app/api/ipaas/connectors/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.randomUUID.mockReturnValue("12345678-1234-1234-1234-123456789abc");
  mocks.isPlatformRegistered.mockReturnValue(true);
  mocks.encryptConnectorHeaders.mockReturnValue("encrypted_creds");
});

describe("GET /api/ipaas/connectors", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/ipaas/connectors") as any);
    expect(res.status).toBe(401);
  });

  it("returns 400 when workspaceId is missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/ipaas/connectors") as any);
    expect(res.status).toBe(400);
  });

  it("returns 404 when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/ipaas/connectors?workspaceId=ws_bad") as any);
    expect(res.status).toBe(404);
  });

  it("returns connectors list", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    const now = new Date();
    mocks.connectorFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([
        { connectorId: "ipc_1", workspaceId: "ws_1", platform: "feishu", name: "Test", inboundEnabled: true, outboundEnabled: true, linkedAutomationId: null, status: "active", lastActivityAt: null, lastError: null, createdAt: now },
      ]) }) }),
    });

    const res = await GET(new NextRequest("http://localhost/api/ipaas/connectors?workspaceId=ws_1") as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connectors).toHaveLength(1);
    expect(body.connectors[0].connectorId).toBe("ipc_1");
  });
});

describe("POST /api/ipaas/connectors", () => {
  it("returns 400 for invalid body", async () => {
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_1" }) }) as any);
    expect(res.status).toBe(400);
  });

  it("returns 404 when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_bad", platform: "feishu", name: "Test", credentials: { appId: "cli_1", appSecret: "secret" } }) }) as any);
    expect(res.status).toBe(404);
  });

  it("returns 400 for feishu without appId", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_1", platform: "feishu", name: "Test", credentials: { appId: "" } }) }) as any);
    expect(res.status).toBe(400);
  });

  it("creates a feishu connector", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    const now = new Date();
    mocks.connectorCreate.mockResolvedValue({
      connectorId: "ipc_new", workspaceId: "ws_1", platform: "feishu", name: "My Bot",
      inboundEnabled: true, outboundEnabled: true, linkedAutomationId: null,
      status: "active", lastActivityAt: null, lastError: null, createdAt: now,
    });

    const res = await POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ workspaceId: "ws_1", platform: "feishu", name: "My Bot", credentials: { appId: "cli_1", appSecret: "secret" }, inboundEnabled: true, outboundEnabled: true }) }) as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.connector.connectorId).toBe("ipc_new");
    expect(body.connector.platform).toBe("feishu");
  });
});
