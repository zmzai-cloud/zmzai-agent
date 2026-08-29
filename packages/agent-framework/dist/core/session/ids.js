import { randomUUID } from "node:crypto";
/** Prefixed ascending-ish IDs, aligned with the v0 wire spec (§2). */
export function newSessionId() {
    return `ses_${randomUUID()}`;
}
export function newMessageId() {
    return `msg_${randomUUID()}`;
}
export function newPartId() {
    return `prt_${randomUUID()}`;
}
export function newPermissionRequestId() {
    return `per_${randomUUID()}`;
}
export function newEventId() {
    return `evt_${randomUUID()}`;
}
//# sourceMappingURL=ids.js.map