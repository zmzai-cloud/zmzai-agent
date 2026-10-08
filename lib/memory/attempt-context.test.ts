import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@zmzai/agent-framework";

const mocks = vi.hoisted(() => ({
  ensureRunForFrameworkAttempt: vi.fn(),
  recallMemoryContext: vi.fn(),
  retain: vi.fn(),
}));

vi.mock("@/lib/task-run-control", () => ({ ensureRunForFrameworkAttempt: mocks.ensureRunForFrameworkAttempt }));
vi.mock("./recall-context", () => ({ recallMemoryContext: mocks.recallMemoryContext }));
vi.mock("./provider", () => ({ getMemoryProvider: () => ({ retain: mocks.retain }) }));

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
});
