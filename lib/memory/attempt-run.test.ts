import { beforeEach, describe, expect, it, vi } from "vitest";

import { beginMemoryAttempt, getMemoryAttempt, takeMemoryAttempt } from "./attempt-run";

beforeEach(() => {
  vi.resetModules();
  takeMemoryAttempt("ses_1");
});

describe("memory attempt binding", () => {
  it("consumes one exact Run before a queued follow-up binds the next", () => {
    beginMemoryAttempt("ses_1", "run_1");
    expect(getMemoryAttempt("ses_1")).toBe("run_1");
    expect(takeMemoryAttempt("ses_1")).toBe("run_1");
    expect(getMemoryAttempt("ses_1")).toBeNull();

    beginMemoryAttempt("ses_1", "run_2");
    expect(takeMemoryAttempt("ses_1")).toBe("run_2");
    expect(takeMemoryAttempt("ses_1")).toBeNull();
  });

  it("has no binding after a process module restart", async () => {
    beginMemoryAttempt("ses_1", "run_1");
    vi.resetModules();
    const restarted = await import("./attempt-run");
    expect(restarted.getMemoryAttempt("ses_1")).toBeNull();
    expect(restarted.takeMemoryAttempt("ses_1")).toBeNull();
  });
});
