import { z } from "zod";
import { notifyEventLogListeners } from "@zmzai/agent-framework";
import { appendMemoryEventToMongo } from "@/framework/core/events/mongo-event-log";
import { compareAndSetRetention, writeMemoryRunState, type MemoryHitPreview, type MemoryRunState } from "@/lib/memory/run-state";

const hitSchema = z.strictObject({ memoryId: z.string().optional(), text: z.string() });
const memoryEventSchemas = {
  "memory.recall_succeeded": z.strictObject({ hits: z.array(hitSchema), usedHitCount: z.number().int().min(0).optional() }),
  "memory.recall_unavailable": z.strictObject({}),
  "memory.recall_disabled": z.strictObject({}),
  "memory.retention_pending": z.strictObject({}),
  "memory.retention_succeeded": z.strictObject({}),
  "memory.retention_skipped": z.strictObject({}),
  "memory.retention_failed": z.strictObject({}),
  "memory.retention_unknown": z.strictObject({}),
  "memory.retention_disabled": z.strictObject({}),
} as const;

export type MemoryEventType = keyof typeof memoryEventSchemas;
export type RetentionEventType = Extract<MemoryEventType, `memory.retention_${string}`>;

/** Persistence guard for hook transitions. Returns false when another process
 * already settled this Run, so no duplicate retain or terminal event follows. */
export async function recordRetentionTransition(input: {
  runId: string;
  sessionId: string;
  bankId: string;
  type: RetentionEventType;
  from: MemoryRunState["retention"]["status"];
}): Promise<boolean> {
  const status = input.type.slice("memory.retention_".length) as MemoryRunState["retention"]["status"];
  const state = await compareAndSetRetention({ ...input, to: status, at: new Date() });
  if (!state) return false;
  const persisted = await appendMemoryEventToMongo({
    sessionId: input.sessionId,
    type: input.type,
    data: { runId: input.runId, bankId: input.bankId, status, updatedAt: state.retention.updatedAt },
  });
  notifyEventLogListeners(persisted);
  return true;
}

function boundedHits(hits: z.infer<typeof hitSchema>[]): MemoryHitPreview[] {
  return hits.slice(0, 8).map(({ memoryId, text }) => ({
    ...(memoryId === undefined ? {} : { memoryId }),
    text: Array.from(text).slice(0, 240).join(""),
  }));
}

function parsePayload(type: MemoryEventType, payload: object): { hits?: MemoryHitPreview[]; usedHitCount?: number } {
  const schema = memoryEventSchemas[type] as z.ZodType;
  if (!schema) throw new Error(`INVALID_MEMORY_EVENT: ${type}`);
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error(`INVALID_MEMORY_EVENT: ${type}`);
  return result.data as { hits?: MemoryHitPreview[]; usedHitCount?: number };
}

export async function recordMemoryEvent(input: {
  runId: string;
  sessionId: string;
  bankId: string;
  type: MemoryEventType;
  payload: object;
}): Promise<{ seq: number }> {
  const { runId, sessionId, bankId, type } = input;
  if (!runId || !sessionId || !bankId) throw new Error("INVALID_MEMORY_EVENT: missing identity");
  const payload = parsePayload(type, input.payload);
  const at = new Date();
  let change: Parameters<typeof writeMemoryRunState>[0]["change"];
  if (type === "memory.recall_succeeded") {
    const hits = boundedHits(payload.hits ?? []);
    const usedHitCount = payload.usedHitCount ?? payload.hits?.length ?? 0;
    if (usedHitCount < hits.length) throw new Error("INVALID_MEMORY_EVENT: usedHitCount");
    change = { kind: "recall", status: usedHitCount > 0 ? "hit" : "empty", hits, usedHitCount };
  } else if (type === "memory.recall_unavailable" || type === "memory.recall_disabled") {
    change = { kind: "recall", status: type === "memory.recall_disabled" ? "disabled" : "unavailable", hits: [], usedHitCount: 0 };
  } else {
    change = { kind: "retention", status: type.slice("memory.retention_".length) as MemoryRunState["retention"]["status"] };
  }
  const state = await writeMemoryRunState({ runId, sessionId, bankId, change, at });
  const data = change.kind === "recall"
    ? { runId, bankId, status: state.recall.status, hitCount: state.recall.usedHitCount, observedAt: state.recall.observedAt }
    : { runId, bankId, status: state.retention.status, updatedAt: state.retention.updatedAt };
  const persisted = await appendMemoryEventToMongo({ sessionId, type, data });
  notifyEventLogListeners(persisted);
  return { seq: persisted.seq };
}
