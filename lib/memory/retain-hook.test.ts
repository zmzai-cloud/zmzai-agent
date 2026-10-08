import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retainWithOutcome: vi.fn(),
  configured: true,
  recordMemoryEvent: vi.fn(),
}));

vi.mock("@/lib/memory/provider", () => ({
  getMemoryProvider: () => ({ retainWithOutcome: mocks.retainWithOutcome }),
  isMemoryConfigured: () => mocks.configured,
}));
vi.mock("@/lib/memory/events", () => ({ recordMemoryEvent: mocks.recordMemoryEvent }));

import { clearRetainInFlightForTest, createMemoryRetainHook } from "./retain-hook";
import { beginMemoryAttempt, takeMemoryAttempt } from "./attempt-run";

const baseInput = {
  sessionId: "ses_x",
  agent: "default",
  ok: true,
  aborted: false,
  workspaceId: "ws_1",
  newMessages: [
    { role: "user" as const, text: "帮我部署" },
    { role: "assistant" as const, text: "部署完成" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  clearRetainInFlightForTest();
  takeMemoryAttempt("ses_x");
  mocks.configured = true;
  mocks.retainWithOutcome.mockResolvedValue("succeeded");
  mocks.recordMemoryEvent.mockResolvedValue({ seq: 1 });
});

describe("createMemoryRetainHook", () => {
  it("正常终态：retain 一次，content 为 transcript，context 含 sessionId+runId", async () => {
    beginMemoryAttempt("ses_x", "run_1");
    await createMemoryRetainHook().onRunEnd!(baseInput);
    await vi.waitFor(() => expect(mocks.retainWithOutcome).toHaveBeenCalledTimes(1));
    const call = mocks.retainWithOutcome.mock.calls[0]![0] as { bankId: string; content: string; context: string };
    expect(call.bankId).toBe("ws_1");
    expect(call.content).toBe("user: 帮我部署\nassistant: 部署完成");
    expect(JSON.parse(call.context)).toEqual({ sessionId: "ses_x", runId: "run_1" });
    await vi.waitFor(() => expect(mocks.recordMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "memory.retention_succeeded" })));
    expect(mocks.recordMemoryEvent.mock.calls.map(([event]) => event.type)).toEqual(["memory.retention_pending", "memory.retention_succeeded"]);
  });

  it("deduplicates the same Run while pending and after settlement", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.retainWithOutcome.mockImplementation(() => gate.then(() => "succeeded"));

    const hook = createMemoryRetainHook();
    beginMemoryAttempt("ses_x", "run_1");
    const first = hook.onRunEnd!(baseInput);
    beginMemoryAttempt("ses_x", "run_1");
    const second = hook.onRunEnd!(baseInput);
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(mocks.retainWithOutcome).toHaveBeenCalledTimes(1));

    release();
    // 等 finally 清理 in-flight（retain settle 后的微任务）
    await new Promise((resolve) => setTimeout(resolve, 0));
    beginMemoryAttempt("ses_x", "run_1");
    await hook.onRunEnd!(baseInput);
    expect(mocks.retainWithOutcome).toHaveBeenCalledTimes(1);
  });

  it("missing binding after restart retains best effort without fabricating a Run ID", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createMemoryRetainHook().onRunEnd!(baseInput);
    await vi.waitFor(() => expect(mocks.retainWithOutcome).toHaveBeenCalledTimes(1));
    const call = mocks.retainWithOutcome.mock.calls[0]![0] as { context: string };
    expect(JSON.parse(call.context)).toEqual({ sessionId: "ses_x" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("missing Run binding"));
    warnSpy.mockRestore();
  });

  it("first hook captures its Run synchronously before queued follow-up binds", async () => {
    const hook = createMemoryRetainHook();
    beginMemoryAttempt("ses_x", "run_1");
    const first = hook.onRunEnd!(baseInput);
    beginMemoryAttempt("ses_x", "run_2");
    const second = hook.onRunEnd!({ ...baseInput, newMessages: [{ role: "user", text: "follow-up" }] });
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(mocks.retainWithOutcome).toHaveBeenCalledTimes(2));
    expect(mocks.retainWithOutcome.mock.calls.map(([call]) => JSON.parse(call.context).runId)).toEqual(["run_1", "run_2"]);
  });

  it("空 newMessages / 无 workspaceId：跳过 retain", async () => {
    await createMemoryRetainHook().onRunEnd!({ ...baseInput, newMessages: [] });
    await createMemoryRetainHook().onRunEnd!({ ...baseInput, workspaceId: undefined });
    expect(mocks.retainWithOutcome).not.toHaveBeenCalled();
  });

  it("retain 抛错：仅 warn 不冒泡", async () => {
    mocks.retainWithOutcome.mockRejectedValue(new Error("secret transcript"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createMemoryRetainHook().onRunEnd!(baseInput);
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[memory] retention processing failed for bank ws_1")));
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret transcript");
    warnSpy.mockRestore();
  });

  it("records skipped, disabled, and known failure without changing the Run", async () => {
    const hook = createMemoryRetainHook();
    beginMemoryAttempt("ses_x", "run_skip");
    await hook.onRunEnd!({ ...baseInput, newMessages: [] });
    await vi.waitFor(() => expect(mocks.recordMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_skip", type: "memory.retention_skipped" })));
    mocks.configured = false;
    beginMemoryAttempt("ses_x", "run_disabled");
    await hook.onRunEnd!(baseInput);
    await vi.waitFor(() => expect(mocks.recordMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_disabled", type: "memory.retention_disabled" })));
    mocks.configured = true;
    mocks.retainWithOutcome.mockResolvedValue("failed");
    beginMemoryAttempt("ses_x", "run_failed");
    await hook.onRunEnd!(baseInput);
    await vi.waitFor(() => expect(mocks.recordMemoryEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_failed", type: "memory.retention_failed" })));
  });
});
