import type { EventLog } from "../events/bus.js";
import type { SessionStore } from "../session/store.js";
/** Lease recovery (spec §3.2): the runner stamps a lease on the session
 *  document while it owns a run. A periodic scan reclaims sessions whose lease
 *  lapsed without a live owner (process crash/restart), emitting a settle
 *  event so clients don't sit on a stale "running" status forever.
 *
 *  Storage-agnostic (M5): the session store owns the lease fields; recovery
 *  only needs a list + clear. Implementations provide the store-specific
 *  `listExpiredLeases` / `clearLeaseIfExpired`. */
export declare const scanIntervalMs = 60000;
export declare const leaseDurationMs: number;
export type LeaseRecoveryStore = {
    /** Sessions whose lease lapsed (leaseExpiresAt < now), capped. */
    listExpiredLeases(): Promise<{
        sessionId: string;
    }[]>;
    /** Clears the lease if it is still expired; false if another won the race. */
    clearLeaseIfExpired(sessionId: string): Promise<boolean>;
};
/** Interrupted-run finalization (product P2): when a run dies with its lease
 *  (crash/restart), the run's in-flight projections would otherwise stay
 *  frozen mid-run forever — a pending permission card, tool parts stuck
 *  "running", todos stuck "in_progress". The event log is the projection's
 *  single source of truth, so recovery derives the leftovers from it and
 *  folds each into a terminal state (replied/reject, tool error, cancelled),
 *  both in the store and as appended events. Idempotent: a second pass finds
 *  no pending leftovers. */
export declare function finalizeInterruptedRun(input: {
    sessionId: string;
    log: EventLog;
    store: SessionStore;
}): Promise<void>;
export declare function reclaimExpiredLeases(input: {
    store: LeaseRecoveryStore;
    log: EventLog;
    finalizeStore?: SessionStore;
}): Promise<void>;
export declare function startLeaseRecovery(input: {
    store: LeaseRecoveryStore;
    log: EventLog;
    finalizeStore?: SessionStore;
}): void;
export { leaseDurationMs as fwLeaseDurationMs };
//# sourceMappingURL=lease-recovery.d.ts.map