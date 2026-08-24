import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerEnvironment = vi.hoisted(() => vi.fn());
vi.mock("@/config/env", () => ({ getServerEnvironment }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { listRelayAgentModels } from "@/lib/relay-agent-models";

beforeEach(() => {
  vi.clearAllMocks();
});

const modelData = {
  featured: [{ id: "gpt-4o", name: "GPT-4o", description: "Flagship", maxInputTokens: 128_000, maxOutputTokens: 16_384, allowedReasoningEfforts: ["low", "medium", "high"] }],
  channels: [{ id: "openai", name: "OpenAI", models: [{ id: "gpt-4o", name: "GPT-4o", channel: "openai", maxInputTokens: 128_000, maxOutputTokens: 16_384, allowedReasoningEfforts: ["low", "medium", "high"] }] }],
};

describe("listRelayAgentModels", () => {
  it("returns modelSelectorData on success", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: "secret", RELAY_AGENT_URL: "https://m.zmzai.cloud" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ modelSelectorData: modelData }) });
    const result = await listRelayAgentModels("user_1");
    expect(result).toEqual(modelData);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://m.zmzai.cloud/api/internal/agent/models",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
        body: JSON.stringify({ userId: "user_1" }),
      }),
    );
  });

  it("strips trailing slash from RELAY_AGENT_URL", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: "s", RELAY_AGENT_URL: "https://m.zmzai.cloud/" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ modelSelectorData: modelData }) });
    await listRelayAgentModels("u");
    expect(fetchMock).toHaveBeenCalledWith("https://m.zmzai.cloud/api/internal/agent/models", expect.anything());
  });

  it("throws when secret is not configured", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: undefined, RELAY_AGENT_URL: "https://m.zmzai.cloud" });
    await expect(listRelayAgentModels("u")).rejects.toThrow("RELAY_AGENT_SERVICE_SECRET_CURRENT");
  });

  it("throws with error string from response body", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: "s", RELAY_AGENT_URL: "https://m.zmzai.cloud" });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Access denied for this user" }) });
    await expect(listRelayAgentModels("u")).rejects.toThrow("Access denied for this user");
  });

  it("throws default message when body has no error string", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: "s", RELAY_AGENT_URL: "https://m.zmzai.cloud" });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(listRelayAgentModels("u")).rejects.toThrow("无法读取可用模型目录");
  });

  it("throws when modelSelectorData is missing from OK response", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: "s", RELAY_AGENT_URL: "https://m.zmzai.cloud" });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(listRelayAgentModels("u")).rejects.toThrow("无法读取可用模型目录");
  });

  it("handles non-JSON response body gracefully", async () => {
    getServerEnvironment.mockReturnValue({ RELAY_AGENT_SERVICE_SECRET_CURRENT: "s", RELAY_AGENT_URL: "https://m.zmzai.cloud" });
    fetchMock.mockResolvedValue({ ok: false, json: async () => null });
    await expect(listRelayAgentModels("u")).rejects.toThrow("无法读取可用模型目录");
  });
});
