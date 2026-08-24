import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ----

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/internal-contracts", () => ({
  sandboxAgentContractVersion: "v1",
  sandboxRunResponseSchema: {
    safeParse: (data: unknown) => ({ success: true, data }),
  },
}));

import {
  AgentSandboxError,
  streamAgentSandboxEvents,
  createAgentSandboxRun,
  getAgentSandboxRun,
  cancelAgentSandboxRun,
  getAgentSandboxRunArtifacts,
} from "@/lib/sandbox-client";

const ENV = {
  SANDBOX_AGENT_URL: "http://sandbox.test",
  SANDBOX_AGENT_SERVICE_SECRET_CURRENT: "secret_123",
};

function setEnv() {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
}
function clearEnv() {
  for (const k of Object.keys(ENV)) delete process.env[k];
}

beforeEach(() => {
  vi.clearAllMocks();
  clearEnv();
});

// ---- AgentSandboxError ----

describe("AgentSandboxError", () => {
  it("has correct name, code, and optional status", () => {
    const err = new AgentSandboxError("TEST_CODE", "something broke", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentSandboxError");
    expect(err.code).toBe("TEST_CODE");
    expect(err.status).toBe(500);
    expect(err.message).toBe("something broke");
  });

  it("works without status", () => {
    const err = new AgentSandboxError("CODE", "msg");
    expect(err.status).toBeUndefined();
  });
});

// ---- sandboxConfig (tested indirectly via createAgentSandboxRun) ----

describe("sandboxConfig validation", () => {
  it("throws SANDBOX_NOT_CONFIGURED when env is missing", async () => {
    await expect(createAgentSandboxRun({
      userId: "u", taskRunId: "t", requestId: "r",
      snapshot: { revisionId: null, files: [] },
      command: { program: "bash", args: [] },
    })).rejects.toThrow("SANDBOX_AGENT_URL");
  });

  it("throws when URL is empty", async () => {
    process.env.SANDBOX_AGENT_URL = "";
    process.env.SANDBOX_AGENT_SERVICE_SECRET_CURRENT = "s";
    try {
      await createAgentSandboxRun({
        userId: "u", taskRunId: "t", requestId: "r",
        snapshot: { revisionId: null, files: [] },
        command: { program: "bash", args: [] },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_NOT_CONFIGURED");
    }
  });
});

// ---- createAgentSandboxRun ----

describe("createAgentSandboxRun", () => {
  it("sends POST and returns run view on success", async () => {
    setEnv();
    const runView = { id: "run_1", userId: "u", status: "queued", events: [], createdAt: "2026-01-01T00:00:00Z" };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ run: runView }) });
    const result = await createAgentSandboxRun({
      userId: "u", taskRunId: "t", requestId: "r",
      snapshot: { revisionId: null, files: [] },
      command: { program: "bash", args: ["-c", "echo hi"] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sandbox.test/api/internal/agent/runs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.id).toBe("run_1");
  });

  it("throws SANDBOX_UNAVAILABLE when fetch fails", async () => {
    setEnv();
    fetchMock.mockRejectedValue(new TypeError("network error"));
    try {
      await createAgentSandboxRun({
        userId: "u", taskRunId: "t", requestId: "r",
        snapshot: { revisionId: null, files: [] },
        command: { program: "bash", args: [] },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_UNAVAILABLE");
    }
  });

  it("throws parsed error on non-ok response", async () => {
    setEnv();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ code: "RATE_LIMITED", error: "Too many requests" }),
    });
    try {
      await createAgentSandboxRun({
        userId: "u", taskRunId: "t", requestId: "r",
        snapshot: { revisionId: null, files: [] },
        command: { program: "bash", args: [] },
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentSandboxError);
      expect((err as AgentSandboxError).code).toBe("RATE_LIMITED");
    }
  });
});

// ---- getAgentSandboxRun ----

describe("getAgentSandboxRun", () => {
  it("returns null on 404", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: true, status: 404 });
    const result = await getAgentSandboxRun("run_missing");
    expect(result).toBeNull();
  });

  it("returns run view on success", async () => {
    setEnv();
    const runView = { id: "run_2", userId: "u", status: "running", events: [], createdAt: "2026-01-01T00:00:00Z" };
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ run: runView }) });
    const result = await getAgentSandboxRun("run_2");
    expect(result?.id).toBe("run_2");
    expect(result?.status).toBe("running");
  });

  it("includes auth headers", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: true, status: 404 });
    await getAgentSandboxRun("run_x");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sandbox.test/api/internal/agent/runs/run_x",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret_123",
          "x-zmzai-contract-version": "v1",
        }),
      }),
    );
  });
});

// ---- cancelAgentSandboxRun ----

describe("cancelAgentSandboxRun", () => {
  it("sends POST to cancel endpoint", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await cancelAgentSandboxRun("run_1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://sandbox.test/api/internal/agent/runs/run_1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("silently returns on 404", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: true, status: 404 });
    await expect(cancelAgentSandboxRun("run_gone")).resolves.toBeUndefined();
  });
});

// ---- getAgentSandboxRunArtifacts ----

describe("getAgentSandboxRunArtifacts", () => {
  it("returns empty array on 404", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: true, status: 404 });
    const result = await getAgentSandboxRunArtifacts("run_missing");
    expect(result).toEqual([]);
  });

  it("returns artifacts on success", async () => {
    setEnv();
    const artifacts = [{ path: "out.txt", bytes: 42, contentType: "text/plain", sha256: "a".repeat(64), tooLarge: false }];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ artifacts }) });
    const result = await getAgentSandboxRunArtifacts("run_1");
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("out.txt");
  });
});

// ---- parseError (tested indirectly) ----

describe("parseError status mapping", () => {
  it("returns SANDBOX_AUTH_FAILED for 401", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "" });
    try {
      await getAgentSandboxRun("run_x");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_AUTH_FAILED");
    }
  });

  it("returns SANDBOX_AUTH_FAILED for 403", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "" });
    try {
      await getAgentSandboxRun("run_x");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_AUTH_FAILED");
    }
  });

  it("extracts code and error from JSON body", async () => {
    setEnv();
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      text: async () => JSON.stringify({ code: "INVALID_INPUT", error: "Bad request body" }),
    });
    try {
      await getAgentSandboxRun("run_x");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("INVALID_INPUT");
      expect((err as AgentSandboxError).message).toBe("Bad request body");
    }
  });

  it("handles non-JSON error body gracefully", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal Server Error" });
    try {
      await getAgentSandboxRun("run_x");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_REQUEST_FAILED");
      expect((err as AgentSandboxError).message).toBe("Internal Server Error");
    }
  });
});

// ---- streamAgentSandboxEvents ----

describe("streamAgentSandboxEvents", () => {
  function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index++]!));
        } else {
          controller.close();
        }
      },
    });
  }

  it("parses well-formed SSE frames", async () => {
    setEnv();
    const frame1 = 'event: message\ndata: {"id":"e1","sequence":1,"type":"stdout","at":"2026-01-01T00:00:00Z","data":{"text":"hello"}}\n\n';
    const frame2 = 'data: {"id":"e2","sequence":2,"type":"stderr","at":"2026-01-01T00:00:01Z","data":{"text":"warn"}}\n\n';
    const stream = makeSSEStream([frame1 + frame2]);
    fetchMock.mockResolvedValue({ ok: true, body: stream });

    const events: { sequence: number; type: string; text: string }[] = [];
    await streamAgentSandboxEvents("run_1", (e) => events.push(e));

    expect(events).toHaveLength(2);
    expect(events[0]!.sequence).toBe(1);
    expect(events[0]!.type).toBe("stdout");
    expect(events[0]!.text).toBe("hello");
    expect(events[1]!.sequence).toBe(2);
    expect(events[1]!.type).toBe("stderr");
    expect(events[1]!.text).toBe("warn");
  });

  it("handles chunked delivery (partial frames)", async () => {
    setEnv();
    const fullFrame = 'data: {"sequence":5,"type":"exit","at":"2026-01-01T00:00:02Z","data":{"text":"done"}}\n\n';
    // Split frame across chunks
    const mid = Math.floor(fullFrame.length / 2);
    const stream = makeSSEStream([fullFrame.slice(0, mid), fullFrame.slice(mid)]);
    fetchMock.mockResolvedValue({ ok: true, body: stream });

    const events: { sequence: number; type: string }[] = [];
    await streamAgentSandboxEvents("run_1", (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0]!.sequence).toBe(5);
    expect(events[0]!.type).toBe("exit");
  });

  it("ignores malformed data lines", async () => {
    setEnv();
    const stream = makeSSEStream([
      'data: not-json\n\n',
      'data: {"sequence":1,"type":"ok","at":"t","data":{"text":"good"}}\n\n',
    ]);
    fetchMock.mockResolvedValue({ ok: true, body: stream });
    const events: { sequence: number; type: string }[] = [];
    await streamAgentSandboxEvents("run_1", (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("ok");
  });

  it("returns early when aborted before fetch", async () => {
    setEnv();
    const ac = new AbortController();
    ac.abort();
    fetchMock.mockRejectedValue(new DOMException("aborted", "AbortError"));
    // Should not throw when signal is already aborted
    await streamAgentSandboxEvents("run_1", () => {}, ac.signal);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("throws SANDBOX_UNAVAILABLE when fetch fails without abort", async () => {
    setEnv();
    fetchMock.mockRejectedValue(new TypeError("network"));
    try {
      await streamAgentSandboxEvents("run_1", () => {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_UNAVAILABLE");
    }
  });

  it("throws SANDBOX_STREAM_EMPTY when response has no body", async () => {
    setEnv();
    fetchMock.mockResolvedValue({ ok: true, body: null });
    try {
      await streamAgentSandboxEvents("run_1", () => {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AgentSandboxError).code).toBe("SANDBOX_STREAM_EMPTY");
    }
  });

  it("uses event type from SSE event: field as fallback", async () => {
    setEnv();
    const stream = makeSSEStream([
      'event: custom_type\ndata: {"sequence":9,"at":"t","data":{"text":"fallback"}}\n\n',
    ]);
    fetchMock.mockResolvedValue({ ok: true, body: stream });
    const events: { type: string }[] = [];
    await streamAgentSandboxEvents("run_1", (e) => events.push(e));
    expect(events[0]!.type).toBe("custom_type");
  });
});
