import type { FrameworkEvent, PersistedFrameworkEvent } from "./manifest.js";
/** EventLog (spec §4.1 abstracted for M5): the durable per-session event log.
 *  The framework ships an in-memory implementation (below) and a JSONL one;
 *  the product supplies a Mongo implementation (see zmzai-agent's
 *  framework/core/events/mongo-event-log.ts). All methods must be safe under
 *  the single-writer-per-session lease model. */
export interface EventLog {
    /** Persists one validated event, allocating the next per-session seq. */
    append(event: FrameworkEvent & {
        sessionId: string;
    }): Promise<PersistedFrameworkEvent>;
    /** Reads events with seq > sinceSeq, ascending, capped at limit. */
    read(sessionId: string, sinceSeq: number, limit: number): Promise<PersistedFrameworkEvent[]>;
    /** Raw record count (stats/audit). */
    count(sessionId: string): Promise<number>;
}
export declare function createMemoryEventLog(): EventLog;
export type SubscribeOptions = {
    sinceSeq?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
};
/** Subscribes to a session's event stream: durable catch-up via log.read, then
 *  live delivery via the in-process listener registry. Cross-process delivery
 *  (product's Mongo log) works because log.read polls the durable store. */
export declare function subscribeEventLog(log: EventLog, sessionId: string, options?: SubscribeOptions): AsyncIterable<PersistedFrameworkEvent>;
/** Notifies live subscribers (called by framework when an event is appended —
 *  the runner does this after EventLog.append). */
export declare function notifyEventLogListeners(event: PersistedFrameworkEvent): void;
//# sourceMappingURL=bus.d.ts.map