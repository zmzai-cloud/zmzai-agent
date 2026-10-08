import { MemoryRunStateModel, type MemoryRunStateRecord } from "@/models/memory-run-state";
import { notifyEventLogListeners } from "@zmzai/agent-framework";
import { appendMemoryEventToMongo } from "@/framework/core/events/mongo-event-log";

export type MemoryHitPreview = { memoryId?: string; text: string };
export type MemoryRunState = {
  runId: string;
  sessionId: string;
  bankId: string;
  recall: {
    status: "pending" | "hit" | "empty" | "unavailable" | "disabled";
    hits: MemoryHitPreview[];
    observedAt: string | null;
  };
  retention: {
    status: "not_started" | "pending" | "succeeded" | "skipped" | "failed" | "unknown" | "disabled";
    updatedAt: string | null;
  };
};

type StateChange =
  | { kind: "recall"; status: MemoryRunState["recall"]["status"]; hits: MemoryHitPreview[] }
  | { kind: "retention"; status: MemoryRunState["retention"]["status"] };

function toState(record: MemoryRunStateRecord): MemoryRunState {
  const recall = record.recall;
  const retention = record.retention;
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    bankId: record.bankId,
    recall: {
      status: (recall?.status ?? "pending") as MemoryRunState["recall"]["status"],
      hits: (recall?.hits ?? []).map((hit) => ({ ...(hit.memoryId ? { memoryId: hit.memoryId } : {}), text: hit.text })),
      observedAt: recall?.observedAt?.toISOString() ?? null,
    },
    retention: {
      status: (retention?.status ?? "not_started") as MemoryRunState["retention"]["status"],
      updatedAt: retention?.updatedAt?.toISOString() ?? null,
    },
  };
}

export async function readMemoryRunState(runId: string): Promise<MemoryRunState | null> {
  const record = await MemoryRunStateModel.findOne({ runId }).lean();
  return record ? toState(record) : null;
}

export async function compareAndSetRetention(input: {
  runId: string;
  sessionId: string;
  bankId: string;
  from: MemoryRunState["retention"]["status"];
  to: MemoryRunState["retention"]["status"];
  at: Date;
}): Promise<MemoryRunState | null> {
  const { runId, sessionId, bankId, from, to, at } = input;
  if (from === "not_started") {
    // Create the receipt only once. A terminal receipt must never be reset by
    // a duplicate hook, including after a process restart.
    await MemoryRunStateModel.findOneAndUpdate(
      { runId },
      { $setOnInsert: { runId, sessionId, bankId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  }
  const changed = await MemoryRunStateModel.findOneAndUpdate(
    { runId, sessionId, bankId, "retention.status": from },
    { $set: { "retention.status": to, "retention.updatedAt": at } },
    { new: true },
  ).lean();
  return changed ? toState(changed) : null;
}

/** Reconcile a receipt left pending by a crash or an interrupted retain request. */
export async function settleStaleRetention(runId: string, now: Date): Promise<MemoryRunState> {
  const cutoff = new Date(now.getTime() - 10_000);
  const changed = await MemoryRunStateModel.findOneAndUpdate(
    { runId, "retention.status": "pending", "retention.updatedAt": { $lte: cutoff } },
    { $set: { "retention.status": "unknown", "retention.updatedAt": now } },
    { new: true },
  ).lean();
  if (changed) {
    const state = toState(changed);
    const persisted = await appendMemoryEventToMongo({
      sessionId: state.sessionId,
      type: "memory.retention_unknown",
      data: { runId, bankId: state.bankId, status: "unknown", updatedAt: state.retention.updatedAt },
    });
    notifyEventLogListeners(persisted);
    return state;
  }
  const state = await readMemoryRunState(runId);
  if (!state) throw new Error("MEMORY_RUN_STATE_NOT_FOUND");
  return state;
}

export async function writeMemoryRunState(input: {
  runId: string;
  sessionId: string;
  bankId: string;
  change: StateChange;
  at: Date;
}): Promise<MemoryRunState> {
  const { runId, sessionId, bankId, change, at } = input;
  const set = change.kind === "recall"
    ? { "recall.status": change.status, "recall.hits": change.hits, "recall.observedAt": at }
    : { "retention.status": change.status, "retention.updatedAt": at };
  const record = await MemoryRunStateModel.findOneAndUpdate(
    { runId, sessionId, bankId },
    { $setOnInsert: { runId, sessionId, bankId }, $set: set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  if (!record) throw new Error("MEMORY_RUN_STATE_WRITE_FAILED");
  return toState(record);
}
