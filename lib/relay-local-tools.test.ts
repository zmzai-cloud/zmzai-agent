import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetServerEnvironmentForTest } from "@/config/env";

import {
  dispatchLocalTool,
  localFsReadTool,
  localFsWriteTool,
  localNotifyTool,
  localShellExecTool,
  probeLocalClient,
  resolveLocalTools,
} from "@/lib/relay-local-tools";

const REQUIRED_ENV: Record<string, string> = {
  MONGODB_URI: "mongodb://test",
  AUTH_SECRET: "a".repeat(32),
  RELAY_AGENT_URL: "http://relay.test",
  RELAY_AGENT_SERVICE_SECRET_CURRENT: "test-agent-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(REQUIRED_ENV)) process.env[key] = value;
  resetServerEnvironmentForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(REQUIRED_ENV)) delete process.env[key];
  resetServerEnvironmentForTest();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("resolveLocalTools", () => {
  it("exposes the four local capabilities with OpenAI-safe tool ids", () => {
    const tools = resolveLocalTools();
    expect(tools.map((tool) => tool.id)).toEqual([
      "local_fs_read",
      "local_fs_write",
      "local_shell_exec",
      "local_notify",
    ]);
    for (const tool of tools) {
      expect(tool.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("routes permissions through the 'local' permission kind", () => {
    expect(localFsReadTool.permission({ path: "~/notes.txt" })).toMatchObject({ permission: "local", patterns: ["~/notes.txt"], metadata: { tool: "fs.read" } });
    expect(localFsWriteTool.permission({ path: "/tmp/a.txt", content: "x" })).toMatchObject({ permission: "local", patterns: ["/tmp/a.txt"] });
    expect(localShellExecTool.permission({ command: "ls -la" })).toMatchObject({ permission: "local", patterns: ["ls -la"] });
    expect(localNotifyTool.permission({ title: "hi" })).toMatchObject({ permission: "local", patterns: ["notify"] });
  });
});

describe("dispatchLocalTool", () => {
  it("posts the tool call to the relay local-tool endpoint with agent identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "req-1", ok: true, data: { content: "hi" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchLocalTool({ userId: "user-1", tool: "fs.read", params: { path: "~/a.txt" }, requestId: "call-1" });

    expect(result).toEqual({ id: "req-1", ok: true, data: { content: "hi" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://relay.test/api/internal/agent/local-tool");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer test-agent-secret");
    expect((init.headers as Record<string, string>)["x-zmzai-agent-user-id"]).toBe("user-1");
    expect(JSON.parse(String(init.body))).toEqual({ tool: "fs.read", params: { path: "~/a.txt" }, requestId: "call-1" });
  });

  it("maps an offline client to a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { code: "CLIENT_OFFLINE", error: "用户 xxx 当前没有在线的桌面客户端" })));
    await expect(dispatchLocalTool({ userId: "user-1", tool: "notify", params: { title: "x" } })).rejects.toThrow("桌面客户端当前不在线");
  });

  it("maps a dispatch timeout to a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(504, { code: "DISPATCH_TIMEOUT", error: "请求超时" })));
    await expect(dispatchLocalTool({ userId: "user-1", tool: "notify", params: { title: "x" } })).rejects.toThrow("本机操作超时");
  });

  it("surfaces ok=false results for the tool layer to report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { id: "req-2", ok: false, error: "文件不存在" })));
    const result = await dispatchLocalTool({ userId: "user-1", tool: "fs.read", params: { path: "~/nope.txt" } });
    expect(result).toEqual({ id: "req-2", ok: false, error: "文件不存在" });
  });
});

describe("probeLocalClient", () => {
  it("returns bound when the user has an online client", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { bound: true, clientId: "c-1" })));
    expect(await probeLocalClient("user-1")).toEqual({ bound: true });
  });

  it("returns unbound on 404 or transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { error: "user_not_bound" })));
    expect(await probeLocalClient("user-2")).toEqual({ bound: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    expect(await probeLocalClient("user-2")).toEqual({ bound: false });
  });
});
