import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  find: vi.fn(),
  createAgentApiKey: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/agent-api-keys", () => ({
  agentApiScopes: ["tasks:read", "tasks:write", "sessions:read", "sessions:write"],
  createAgentApiKey: mocks.createAgentApiKey,
}));
vi.mock("@/lib/workspaces", () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock("@/models/agent-api-key", () => ({ AgentApiKeyModel: { find: mocks.find } }));

import { GET, POST } from "@/app/api/api-keys/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("GET /api/api-keys", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns keys list", async () => {
    const now = new Date();
    mocks.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { agentApiKeyId: "key_1", prefix: "zk_a", name: "My Key", workspaceIds: ["ws_1"], scopes: ["tasks:read"], status: "active", lastUsedAt: null, revokedAt: null, createdAt: now },
          ]),
        }),
      }),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].id).toBe("key_1");
    expect(body.keys[0].prefix).toBe("zk_a");
    expect(body.keys[0].name).toBe("My Key");
  });

  it("returns empty array when no keys", async () => {
    mocks.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) });
    const res = await GET();
    const body = await res.json();
    expect(body.keys).toEqual([]);
  });
});

describe("POST /api/api-keys", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const res = await POST(
      new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ name: "" }), headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when workspace does not exist", async () => {
    mocks.getWorkspace.mockResolvedValue(null);
    const res = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "Test", workspaceIds: ["ws_bad"], scopes: ["tasks:read"] }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("creates an API key successfully", async () => {
    mocks.getWorkspace.mockResolvedValue({ workspaceId: "ws_1" });
    const now = new Date();
    mocks.createAgentApiKey.mockResolvedValue({
      key: "zk_full_secret",
      record: { agentApiKeyId: "key_new", prefix: "zk_n", name: "New Key", workspaceIds: ["ws_1"], scopes: ["tasks:read"], status: "active", lastUsedAt: null, revokedAt: null, createdAt: now },
    });
    const res = await POST(
      new NextRequest("http://localhost", {
        method: "POST",
        body: JSON.stringify({ name: "New Key", workspaceIds: ["ws_1"], scopes: ["tasks:read"] }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toBe("zk_full_secret");
    expect(body.record.id).toBe("key_new");
  });
});
