import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>>, seq: 0, notify: vi.fn() }));
vi.mock("@/models/memory-run-state", () => ({
  MemoryRunStateModel: {
    findOneAndUpdate: vi.fn((query: { runId: string; sessionId: string; bankId: string }, update: { $set: Record<string, unknown> }) => ({ lean: async () => ({
      ...query,
      recall: { status: update.$set["recall.status"] ?? "pending", hits: update.$set["recall.hits"] ?? [], observedAt: update.$set["recall.observedAt"] ?? null },
      retention: { status: update.$set["retention.status"] ?? "not_started", updatedAt: update.$set["retention.updatedAt"] ?? null },
    }) })),
  },
}));
vi.mock("@/framework/core/events/mongo-models", () => ({
  FrameworkSeqModel: { findOneAndUpdate: vi.fn(() => ({ lean: async () => ({ seq: ++mocks.seq }) })) },
  FrameworkEventModel: {
    create: vi.fn(async (record: Record<string, unknown>) => { mocks.records.push(record); }),
    find: vi.fn((query: { sessionId: string; seq: { $gt: number } }) => ({
      sort: () => ({ limit: (limit: number) => ({ lean: async () => mocks.records.filter((record) => record.sessionId === query.sessionId && Number(record.seq) > query.seq.$gt).slice(0, limit) }) }),
    })),
  },
}));
vi.mock("@zmzai/agent-framework", async (importOriginal) => {
  const original = await importOriginal<typeof import("@zmzai/agent-framework")>();
  return { ...original, notifyEventLogListeners: mocks.notify };
});

import { mongoEventLog } from "@/framework/core/events/mongo-event-log";
import { recordMemoryEvent } from "@/lib/memory/events";

beforeEach(() => { mocks.records.length = 0; mocks.seq = 0; mocks.notify.mockClear(); });

it("shares session sequence with framework events and replays memory frames", async () => {
  const first = await recordMemoryEvent({ runId: "run_1", sessionId: "ses_1", bankId: "ws_1", type: "memory.recall_succeeded", payload: { hits: [{ text: "prefers concise answers" }] } });
  const middle = await mongoEventLog.append({ sessionId: "ses_1", type: "session.status", data: { status: "running" } });
  const last = await recordMemoryEvent({ runId: "run_1", sessionId: "ses_1", bankId: "ws_1", type: "memory.retention_pending", payload: {} });
  expect([first.seq, middle.seq, last.seq]).toEqual([1, 2, 3]);
  const replay = await mongoEventLog.read("ses_1", 1, 20);
  expect(replay.map((event) => [event.seq, event.type])).toEqual([[2, "session.status"], [3, "memory.retention_pending"]]);
  expect((await mongoEventLog.read("ses_1", 0, 20)).at(-1)?.type).toBe("memory.retention_pending");
  expect(mocks.notify).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(mocks.records)).not.toContain("prefers concise answers");
});

it("rejects unsupported memory event names and invalid payloads before persistence", async () => {
  await expect(recordMemoryEvent({ runId: "run_1", sessionId: "ses_1", bankId: "ws_1", type: "memory.other" as never, payload: {} })).rejects.toThrow("INVALID_MEMORY_EVENT");
  await expect(recordMemoryEvent({ runId: "run_1", sessionId: "ses_1", bankId: "ws_1", type: "memory.recall_succeeded", payload: { hits: "secret" } })).rejects.toThrow("INVALID_MEMORY_EVENT");
  expect(mocks.records).toHaveLength(0);
});
