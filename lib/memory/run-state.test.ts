import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  states: new Map<string, Record<string, unknown>>(),
  createEvent: vi.fn(),
  seq: 0,
}));

vi.mock("@/models/memory-run-state", () => ({
  MemoryRunStateModel: {
    findOne: vi.fn((query: { runId: string }) => ({ lean: async () => mocks.states.get(query.runId) ?? null })),
    findOneAndUpdate: vi.fn((query: { runId: string; "retention.status"?: string; "retention.updatedAt"?: { $lte: Date } }, update: { $setOnInsert?: Record<string, unknown>; $set: Record<string, unknown> }) => {
      const existing = mocks.states.get(query.runId);
      if (query["retention.status"] && (!existing || (existing.retention as { status: string; updatedAt: Date }).status !== query["retention.status"] || (existing.retention as { updatedAt: Date }).updatedAt > query["retention.updatedAt"]!.$lte)) return { lean: async () => null };
      const current = mocks.states.get(query.runId) ?? {
        ...update.$setOnInsert,
        recall: { status: "pending", hits: [], observedAt: null },
        retention: { status: "not_started", updatedAt: null },
      };
      const next = structuredClone(current);
      for (const [path, value] of Object.entries(update.$set)) {
        const [group, field] = path.split(".");
        (next[group] as Record<string, unknown>)[field] = value;
      }
      mocks.states.set(query.runId, next);
      return { lean: async () => next };
    }),
  },
}));
vi.mock("@/framework/core/events/mongo-models", () => ({
  FrameworkSeqModel: { findOneAndUpdate: vi.fn(() => ({ lean: async () => ({ seq: ++mocks.seq }) })) },
  FrameworkEventModel: { create: mocks.createEvent },
}));
vi.mock("@/lib/database/mongodb", () => ({
  connectMongo: vi.fn(async () => ({ startSession: async () => ({
    withTransaction: async (callback: () => Promise<unknown>) => callback(),
    endSession: async () => {},
  }) })),
}));
vi.mock("@zmzai/agent-framework", async (importOriginal) => {
  const original = await importOriginal<typeof import("@zmzai/agent-framework")>();
  return { ...original, notifyEventLogListeners: vi.fn() };
});

import { recordMemoryEvent } from "@/lib/memory/events";
import { readMemoryRunState, settleStaleRetention } from "@/lib/memory/run-state";

beforeEach(() => {
  mocks.states.clear();
  mocks.seq = 0;
  mocks.createEvent.mockReset().mockResolvedValue({});
});

describe("memory Run receipts", () => {
  it("stores a hit receipt with bounded previews and an actual observation time", async () => {
    const hits = Array.from({ length: 10 }, (_, index) => ({ memoryId: `mem_${index}`, text: "x".repeat(300) }));
    await recordMemoryEvent({ runId: "run_1", sessionId: "ses_1", bankId: "ws_1", type: "memory.recall_succeeded", payload: { hits } });
    const state = await readMemoryRunState("run_1");
    expect(state).toMatchObject({ runId: "run_1", sessionId: "ses_1", bankId: "ws_1", recall: { status: "hit" }, retention: { status: "not_started" } });
    expect(state?.recall.hits).toHaveLength(8);
    expect(state?.recall.hits[0]).toEqual({ memoryId: "mem_0", text: "x".repeat(240) });
    expect(state?.recall.observedAt).toBeTruthy();
    expect(JSON.stringify(mocks.createEvent.mock.calls)).not.toContain("x".repeat(240));
  });

  it("stores an empty receipt and never invents a prior observation time", async () => {
    expect(await readMemoryRunState("missing")).toBeNull();
    await recordMemoryEvent({ runId: "run_2", sessionId: "ses_2", bankId: "ws_1", type: "memory.recall_succeeded", payload: { hits: [] } });
    expect(await readMemoryRunState("run_2")).toMatchObject({ recall: { status: "empty", hits: [] } });
  });

  it("persists retention transitions before publishing; append failure leaves state readable", async () => {
    const base = { runId: "run_3", sessionId: "ses_3", bankId: "ws_1" };
    await recordMemoryEvent({ ...base, type: "memory.retention_pending", payload: {} });
    expect((await readMemoryRunState("run_3"))?.recall.observedAt).toBeNull();
    expect((await readMemoryRunState("run_3"))?.retention.status).toBe("pending");
    mocks.createEvent.mockRejectedValueOnce(new Error("append failed"));
    await expect(recordMemoryEvent({ ...base, type: "memory.retention_unknown", payload: {} })).rejects.toThrow("append failed");
    expect((await readMemoryRunState("run_3"))?.retention.status).toBe("unknown");
    expect((await readMemoryRunState("run_3"))?.retention.updatedAt).toBeTruthy();
  });

  it.each([
    ["memory.retention_succeeded", "succeeded"],
    ["memory.retention_skipped", "skipped"],
    ["memory.retention_failed", "failed"],
    ["memory.retention_disabled", "disabled"],
  ] as const)("maps %s to %s", async (type, status) => {
    await recordMemoryEvent({ runId: "run_4", sessionId: "ses_4", bankId: "ws_1", type, payload: {} });
    expect((await readMemoryRunState("run_4"))?.retention.status).toBe(status);
  });

  it("settles a stale pending receipt once and leaves recent or terminal receipts alone", async () => {
    mocks.states.set("run_1", { runId: "run_1", sessionId: "ses_1", bankId: "ws_1", recall: { status: "pending", hits: [], observedAt: null }, retention: { status: "pending", updatedAt: new Date("2026-10-08T10:00:00Z") } });
    expect((await settleStaleRetention("run_1", new Date("2026-10-08T10:00:09Z")))?.retention.status).toBe("pending");
    const [first, second] = await Promise.all([
      settleStaleRetention("run_1", new Date("2026-10-08T10:00:11Z")),
      settleStaleRetention("run_1", new Date("2026-10-08T10:00:12Z")),
    ]);
    expect(first.retention.status).toBe("unknown");
    expect(second.retention.status).toBe("unknown");
    expect(mocks.createEvent).toHaveBeenCalledTimes(1);
  });
});
