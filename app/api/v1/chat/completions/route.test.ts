import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveKey: vi.fn(),
  getEnv: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/public-api", () => ({
  requireAgentApiKey: mocks.resolveKey,
  workspaceAllowed: () => true,
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: mocks.getEnv }));
vi.mock("@/lib/internal-contracts", () => ({ relayAgentContractVersion: "v1" }));

const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = mocks.fetchMock; });

import { POST } from "@/app/api/v1/chat/completions/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveKey.mockResolvedValue({ key: { id: "ak_1", userId: "user_1", workspaceIds: ["ws_1"], scopes: ["chat:write"] } });
  mocks.getEnv.mockReturnValue({ RELAY_AGENT_URL: "https://relay.test.com", RELAY_AGENT_SERVICE_SECRET_CURRENT: "secret_123" });
});

describe("POST /v1/chat/completions", () => {
  it("returns 401 when API key is invalid", async () => {
    mocks.resolveKey.mockResolvedValue({ response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) });
    const res = await POST(makeRequest({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    const res = await POST(makeRequest({ model: "", messages: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 503 when relay secret is not configured", async () => {
    mocks.getEnv.mockReturnValue({ RELAY_AGENT_URL: "https://relay.test.com", RELAY_AGENT_SERVICE_SECRET_CURRENT: null });
    const res = await POST(makeRequest({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }));
    expect(res.status).toBe(503);
  });

  it("returns non-streaming completion response", async () => {
    // Simulate relay SSE response
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}',
      'data: {"choices":[{"delta":{"content":" world"},"index":0}]}',
      'data: {"choices":[{"finish_reason":"stop","index":0}]}',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}',
      "data: [DONE]",
    ].join("\n") + "\n";

    const encoder = new TextEncoder();
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: encoder.encode(sseData) };
            },
          };
        },
      },
    });

    const res = await POST(makeRequest({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }], stream: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello world");
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage.prompt_tokens).toBe(10);
    expect(body.usage.completion_tokens).toBe(2);
    expect(body.usage.total_tokens).toBe(12);
  });

  it("returns streaming SSE response", async () => {
    const sseData = 'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\ndata: [DONE]\n\n';
    const encoder = new TextEncoder();
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: encoder.encode(sseData) };
            },
          };
        },
      },
    });

    const res = await POST(makeRequest({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("returns 502 when relay returns error", async () => {
    mocks.fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal error", body: null });
    const res = await POST(makeRequest({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }));
    expect(res.status).toBe(500);
  });

  it("returns 502 when relay is unreachable", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("network error"));
    const res = await POST(makeRequest({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }));
    expect(res.status).toBe(502);
  });
});
