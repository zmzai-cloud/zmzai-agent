import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  resolveKey: vi.fn(),
  getEnv: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/public-api", () => ({
  requireAgentApiKey: mocks.resolveKey,
  workspaceAllowed: () => true,
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: mocks.getEnv }));

// Mock global fetch for relay proxy calls
const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = mocks.fetchMock; });

import { GET } from "@/app/api/v1/models/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveKey.mockResolvedValue({ key: { id: "ak_1", userId: "user_1", workspaceIds: ["ws_1"], scopes: ["chat:write"] } });
  mocks.getEnv.mockReturnValue({ RELAY_AGENT_URL: "https://relay.test.com", RELAY_AGENT_SERVICE_SECRET_CURRENT: "secret_123" });
});

describe("GET /v1/models", () => {
  it("returns 401 when API key is invalid", async () => {
    mocks.resolveKey.mockResolvedValue({ response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) });
    const res = await GET(new NextRequest("http://localhost/api/v1/models") as any);
    expect(res.status).toBe(401);
  });

  it("returns 503 when relay secret is not configured", async () => {
    mocks.getEnv.mockReturnValue({ RELAY_AGENT_URL: "https://relay.test.com", RELAY_AGENT_SERVICE_SECRET_CURRENT: null });
    const res = await GET(new NextRequest("http://localhost/api/v1/models") as any);
    expect(res.status).toBe(503);
  });

  it("returns models list from relay", async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        modelSelectorData: {
          featured: [{ id: "gpt-4o", name: "gpt-4o", description: "GPT-4o" }],
          channels: [{ id: "openai", models: [{ id: "gpt-4o", name: "gpt-4o" }, { id: "gpt-4o-mini", name: "gpt-4o-mini" }] }],
        },
      }),
    });

    const res = await GET(new NextRequest("http://localhost/api/v1/models") as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(2); // gpt-4o deduplicated, gpt-4o-mini
    expect(body.data[0].id).toBe("gpt-4o");
    expect(body.data[0].object).toBe("model");
    expect(body.data[1].id).toBe("gpt-4o-mini");
  });

  it("returns 502 when relay is unreachable", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("network error"));
    const res = await GET(new NextRequest("http://localhost/api/v1/models") as any);
    expect(res.status).toBe(502);
  });
});
