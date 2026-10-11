import { FrameworkEventModel, FrameworkSeqModel } from "@/framework/core/events/mongo-models";
import { connectMongo } from "@/lib/database/mongodb";
import type { EventLog } from "@zmzai/agent-framework";
import type { FrameworkEvent, PersistedFrameworkEvent } from "@zmzai/agent-framework";
import { newEventId } from "@zmzai/agent-framework";
import { frameworkEventSchemas } from "@zmzai/agent-framework";
import type { FrameworkEventType } from "@zmzai/agent-framework";

async function appendWithSharedSequence(input: { sessionId: string; type: string; data: object }): Promise<PersistedFrameworkEvent> {
  const mongo = await connectMongo();
  const session = await mongo.startSession();
  let persisted: PersistedFrameworkEvent | null = null;
  try {
    // The counter increment and event insert must become visible together.
    // Otherwise an SSE reader can advance past a reserved but uninserted seq.
    await session.withTransaction(async () => {
      const counter = await FrameworkSeqModel.findOneAndUpdate(
        { sessionId: input.sessionId },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session },
      ).lean();
      const event = {
        id: newEventId(),
        sessionId: input.sessionId,
        seq: counter!.seq,
        type: input.type,
        data: input.data,
        at: new Date().toISOString(),
      };
      await FrameworkEventModel.create([{
        eventId: event.id,
        sessionId: event.sessionId,
        seq: event.seq,
        type: event.type,
        data: event.data,
        at: new Date(event.at),
      }], { session });
      persisted = event as PersistedFrameworkEvent;
    });
  } finally {
    await session.endSession();
  }
  if (!persisted) throw new Error("EVENT_APPEND_NOT_COMMITTED");
  return persisted;
}

/** Accepts only product-validated, fact-free memory event data. */
export async function appendMemoryEventToMongo(input: { sessionId: string; type: string; data: object }): Promise<PersistedFrameworkEvent> {
  return appendWithSharedSequence(input);
}

/** Mongo-backed EventLog (product implementation of the framework's EventLog
 *  interface, M5 §3): per-session seq counter + durable fw_events collection,
 *  the same storage the legacy framework used. Reads are the cross-process
 *  catch-up source for SSE subscribers. */
export const mongoEventLog: EventLog = {
  async append(event) {
    const schema = frameworkEventSchemas[event.type as FrameworkEventType];
    const parsed = schema.safeParse(event.data);
    if (!parsed.success) throw new Error(`INVALID_FRAMEWORK_EVENT: ${event.type} ${parsed.error.issues[0]?.message ?? ""}`);
    return appendWithSharedSequence({ sessionId: event.sessionId, type: event.type, data: parsed.data });
  },
  async read(sessionId, sinceSeq, limit) {
    const records = await FrameworkEventModel.find({ sessionId, seq: { $gt: sinceSeq } }).sort({ seq: 1 }).limit(limit).lean();
    return records.map((record) => ({
      id: record.eventId,
      sessionId: record.sessionId,
      seq: record.seq,
      type: record.type as FrameworkEventType,
      data: record.data as PersistedFrameworkEvent["data"],
      at: record.at.toISOString(),
    })) as PersistedFrameworkEvent[];
  },
  async count(sessionId) {
    return FrameworkEventModel.countDocuments({ sessionId });
  },
};

export type { FrameworkEvent, PersistedFrameworkEvent };
