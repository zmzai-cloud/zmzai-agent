import { notifyEventLogListeners } from "../events/bus.js";
/** Lease recovery (spec §3.2): the runner stamps a lease on the session
 *  document while it owns a run. A periodic scan reclaims sessions whose lease
 *  lapsed without a live owner (process crash/restart), emitting a settle
 *  event so clients don't sit on a stale "running" status forever.
 *
 *  Storage-agnostic (M5): the session store owns the lease fields; recovery
 *  only needs a list + clear. Implementations provide the store-specific
 *  `listExpiredLeases` / `clearLeaseIfExpired`. */
export const scanIntervalMs = 60_000;
export const leaseDurationMs = 10 * 60 * 1000;
const globalRecovery = globalThis;
/** Interrupted-run finalization (product P2): when a run dies with its lease
 *  (crash/restart), the run's in-flight projections would otherwise stay
 *  frozen mid-run forever — a pending permission card, tool parts stuck
 *  "running", todos stuck "in_progress". The event log is the projection's
 *  single source of truth, so recovery derives the leftovers from it and
 *  folds each into a terminal state (replied/reject, tool error, cancelled),
 *  both in the store and as appended events. Idempotent: a second pass finds
 *  no pending leftovers. */
export async function finalizeInterruptedRun(input) {
    const events = await input.log.read(input.sessionId, 0, 1_000);
    const append = async (event) => {
        const persisted = await input.log.append({ sessionId: input.sessionId, ...event }).catch(() => null);
        if (persisted)
            notifyEventLogListeners(persisted);
    };
    // 1. Pending permission: a `permission.asked` with no later `replied` for
    //    the same request id. Fold it to `reject` so the card clears.
    for (const asked of events) {
        if (asked.type !== "permission.asked")
            continue;
        const requestId = asked.data.request.id;
        const repliedAfter = events.some((event) => event.type === "permission.replied" && event.data.id === requestId);
        if (repliedAfter)
            continue;
        await append({ type: "permission.replied", data: { id: requestId, reply: "reject" } });
    }
    const runningParts = new Map();
    for (const event of events) {
        if (event.type !== "message.part.updated")
            continue;
        const part = event.data.part;
        if (part.type !== "tool")
            continue;
        if (part.state.status === "running" || part.state.status === "pending")
            runningParts.set(part.id, part);
        else
            runningParts.delete(part.id);
    }
    for (const part of runningParts.values()) {
        const started = part.state.status === "pending" ? new Date().toISOString() : part.state.time.start;
        const terminal = {
            ...part,
            state: {
                status: "error",
                input: part.state.input,
                error: "运行因服务重启中断，可在同一会话继续。",
                time: { start: started, end: new Date().toISOString() },
            },
        };
        await input.store.updatePart(terminal).catch(() => undefined);
        await append({ type: "message.part.updated", data: { part: terminal } });
    }
    // 3. Todos stuck in flight: mark pending/in_progress items cancelled. Todos
    //    are event-only (no store row), so an appended event suffices.
    const lastTodo = [...events].reverse().find((event) => event.type === "todo.updated");
    if (lastTodo) {
        const todos = lastTodo.data.todos;
        if (todos.some((item) => item.status === "pending" || item.status === "in_progress")) {
            const settled = todos.map((item) => (item.status === "pending" || item.status === "in_progress" ? { ...item, status: "cancelled" } : item));
            await append({ type: "todo.updated", data: { todos: settled } });
        }
    }
}
export async function reclaimExpiredLeases(input) {
    const expired = await input.store.listExpiredLeases();
    for (const session of expired) {
        const reclaimed = await input.store.clearLeaseIfExpired(session.sessionId);
        if (!reclaimed)
            continue; // another scanner won the race
        const events = [
            { type: "session.error", data: { name: "LeaseExpired", message: "运行因服务重启中断，可在同一会话继续。" } },
            { type: "session.status", data: { status: "idle" } },
        ];
        for (const event of events) {
            const persisted = await input.log.append({
                sessionId: session.sessionId,
                type: event.type,
                data: event.data,
            }).catch(() => null);
            if (persisted)
                notifyEventLogListeners(persisted);
        }
        if (input.finalizeStore) {
            await finalizeInterruptedRun({ sessionId: session.sessionId, log: input.log, store: input.finalizeStore }).catch(() => undefined);
        }
    }
}
export function startLeaseRecovery(input) {
    if (globalRecovery.__zmzaiFrameworkLeaseTimer)
        return;
    // A process may restart immediately after a lease has expired. Do one scan
    // on startup so those sessions do not remain stale until the first interval.
    void reclaimExpiredLeases(input).catch(() => undefined);
    globalRecovery.__zmzaiFrameworkLeaseTimer = setInterval(() => {
        void reclaimExpiredLeases(input).catch(() => undefined);
    }, scanIntervalMs);
    globalRecovery.__zmzaiFrameworkLeaseTimer.unref?.();
}
export { leaseDurationMs as fwLeaseDurationMs };
//# sourceMappingURL=lease-recovery.js.map