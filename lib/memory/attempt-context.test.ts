import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@zmzai/agent-framework";

const mocks = vi.hoisted(() => ({
  ensureRunForFrameworkAttempt: vi.fn(),
  recallMemoryContext: vi.fn(),
  retain: vi.fn(),
  recordMemoryEvent: vi.fn(),
}));

vi.mock("@/lib/task-run-control", () => ({ ensureRunForFrameworkAttempt: mocks.ensureRunForFrameworkAttempt }));
vi.mock("./recall-context", () => ({ recallMemoryContext: mocks.recallMemoryContext }));
vi.mock("./provider", () => ({ getMemoryProvider: () => ({ retain: mocks.retain }) }));
vi.mock("./events", () => ({ recordMemoryEvent: mocks.recordMemoryEvent }));

import { memoryContextForAttempt } from "./attempt-context";
import { takeMemoryAttempt } from "./attempt-run";
import { clearRetainInFlightForTest, createMemoryRetainHook } from "./retain-hook";

const session = { id: "ses_1", workspaceId: "ws_1", userId: "user_1" } as SessionInfo;

beforeEach(() => {
  vi.clearAllMocks();
  takeMemoryAttempt(session.id);
  clearRetainInFlightForTest();
  mocks.recallMemoryContext.mockResolvedValue("memory context");
  mocks.retain.mockResolvedValue(undefined);
  mocks.recordMemoryEvent.mockResolvedValue({ seq: 1 });
});

describe("memory attempt start", () => {
  it("binds the product Run selected for each actual framework attempt, including a queued follow-up", async () => {
    mocks.ensureRunForFrameworkAttempt
      .mockResolvedValueOnce({ runId: "run_1" })
      .mockResolvedValueOnce({ runId: "run_2" });

    const hook = createMemoryRetainHook();
    const end = (text: string) => hook.onRunEnd!({ sessionId: session.id, workspaceId: session.workspaceId, agent: "default", ok: true, aborted: false, newMessages: [{ role: "user", text }] });

    expect(await memoryContextForAttempt(session, "first", true)).toBe("memory context");
    await end("first");
    expect(await memoryContextForAttempt(session, "queued follow-up", true)).toBe("memory context");
    await end("queued follow-up");
    expect(mocks.retain.mock.calls.map(([call]) => JSON.parse(call.context).runId)).toEqual(["run_1", "run_2"]);
    expect(takeMemoryAttempt(session.id)).toBeNull();
    expect(mocks.ensureRunForFrameworkAttempt).toHaveBeenCalledTimes(2);
  });

  it("keeps framework-only mode best effort without creating a product Run", async () => {
    expect(await memoryContextForAttempt(session, "local prompt", false)).toBe("memory context");
    expect(takeMemoryAttempt(session.id)).toBeNull();
    expect(mocks.ensureRunForFrameworkAttempt).not.toHaveBeenCalled();
  });

  it("uses the bound attempt in the actual recall callback and keeps model context when persistence fails", async () => {
    mocks.ensureRunForFrameworkAttempt.mockResolvedValue({ runId: "run_exact" });
    mocks.recordMemoryEvent.mockRejectedValue(new Error("database down"));
    mocks.recallMemoryContext.mockImplementation(async (_session, _text, _provider, onReceipt) => {
      await onReceipt({ bankId: "ws_1", status: "hit", hits: [{ memoryId: "mem_1", text: "prefer staging first" }] });
      return "memory context";
    });
    await expect(memoryContextForAttempt(session, "部署偏好", true)).resolves.toBe("memory context");
    expect(mocks.recordMemoryEvent).toHaveBeenCalledWith({
      runId: "run_exact", sessionId: "ses_1", bankId: "ws_1",
      type: "memory.recall_succeeded", payload: { hits: [{ memoryId: "mem_1", text: "prefer staging first" }] },
    });
  });

  it("records empty, unavailable, and disabled status for the same bound Run", async () => {
    mocks.ensureRunForFrameworkAttempt.mockResolvedValue({ runId: "run_exact" });
    for (const status of ["empty", "unavailable", "disabled"] as const) {
      mocks.recallMemoryContext.mockImplementationOnce(async (_session, _text, _provider, onReceipt) => {
        await onReceipt({ bankId: "ws_1", status, hits: [] });
      });
      await memoryContextForAttempt(session, "q", true);
    }
    expect(mocks.recordMemoryEvent.mock.calls.map(([call]) => call.type)).toEqual([
      "memory.recall_succeeded", "memory.recall_unavailable", "memory.recall_disabled",
    ]);
  });

  it("attributes queued recall receipts to each exact Run", async () => {
    mocks.ensureRunForFrameworkAttempt
      .mockResolvedValueOnce({ runId: "run_1" })
      .mockResolvedValueOnce({ runId: "run_2" });
    mocks.recallMemoryContext.mockImplementation(async (_session, _text, _provider, onReceipt) => {
      await onReceipt({ bankId: "ws_1", status: "empty", hits: [] });
    });
    await memoryContextForAttempt(session, "first", true);
    await memoryContextForAttempt(session, "queued", true);
    expect(mocks.recordMemoryEvent.mock.calls.map(([call]) => call.runId)).toEqual(["run_1", "run_2"]);
  });

  it("does not wait for receipt persistence before returning model context", async () => {
    mocks.ensureRunForFrameworkAttempt.mockResolvedValue({ runId: "run_exact" });
    mocks.recordMemoryEvent.mockImplementation(() => new Promise(() => undefined));
    mocks.recallMemoryContext.mockImplementation(async (_session, _text, _provider, onReceipt) => {
      await onReceipt({ bankId: "ws_1", status: "hit", hits: [{ text: "fact" }] });
      return "memory context";
    });
    await expect(memoryContextForAttempt(session, "q", true)).resolves.toBe("memory context");
  });
});
