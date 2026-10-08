import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retain: vi.fn(),
}));

vi.mock("@/lib/memory/provider", () => ({
  getMemoryProvider: () => ({ retain: mocks.retain }),
}));

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
  mocks.retain.mockResolvedValue(undefined);
});

describe("createMemoryRetainHook", () => {
  it("正常终态：retain 一次，content 为 transcript，context 含 sessionId+runId", async () => {
    beginMemoryAttempt("ses_x", "run_1");
    await createMemoryRetainHook().onRunEnd!(baseInput);
    expect(mocks.retain).toHaveBeenCalledTimes(1);
    const call = mocks.retain.mock.calls[0]![0] as { bankId: string; content: string; context: string };
    expect(call.bankId).toBe("ws_1");
    expect(call.content).toBe("user: 帮我部署\nassistant: 部署完成");
    expect(JSON.parse(call.context)).toEqual({ sessionId: "ses_x", runId: "run_1" });
  });

  it("同 runId 并发去重：retain 未 settle 时重复触发只 retain 一次，settle 后可再触发", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocks.retain.mockImplementation(() => gate);

    const hook = createMemoryRetainHook();
    beginMemoryAttempt("ses_x", "run_1");
    const first = hook.onRunEnd!(baseInput);
    beginMemoryAttempt("ses_x", "run_1");
    const second = hook.onRunEnd!(baseInput);
    await Promise.all([first, second]);
    expect(mocks.retain).toHaveBeenCalledTimes(1);

    release();
    // 等 finally 清理 in-flight（retain settle 后的微任务）
    await new Promise((resolve) => setTimeout(resolve, 0));
    beginMemoryAttempt("ses_x", "run_1");
    await hook.onRunEnd!(baseInput);
    expect(mocks.retain).toHaveBeenCalledTimes(2);
  });

  it("missing binding after restart retains best effort without fabricating a Run ID", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createMemoryRetainHook().onRunEnd!(baseInput);
    const call = mocks.retain.mock.calls[0]![0] as { context: string };
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
    expect(mocks.retain.mock.calls.map(([call]) => JSON.parse(call.context).runId)).toEqual(["run_1", "run_2"]);
  });

  it("空 newMessages / 无 workspaceId：跳过 retain", async () => {
    await createMemoryRetainHook().onRunEnd!({ ...baseInput, newMessages: [] });
    await createMemoryRetainHook().onRunEnd!({ ...baseInput, workspaceId: undefined });
    expect(mocks.retain).not.toHaveBeenCalled();
  });

  it("retain 抛错：仅 warn 不冒泡", async () => {
    mocks.retain.mockRejectedValue(new Error("hindsight down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await createMemoryRetainHook().onRunEnd!(baseInput);
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[memory] retain failed for bank ws_1:"), expect.any(Error)));
    warnSpy.mockRestore();
  });
});
