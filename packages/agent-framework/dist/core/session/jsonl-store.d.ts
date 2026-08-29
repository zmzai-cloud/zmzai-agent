import type { SessionStore } from "../session/store.js";
/** JSONL SessionStore (spec §3.1 / §11 M4): the zero-dependency local demo
 *  backend. Persists sessions/messages/parts as JSON files under a data dir so
 *  `FW_MODE=local` runs the full framework with no Mongo. Single-process only
 *  — it trades the cloud backend's multi-writer atomicity for zero setup.
 *
 *  Layout: <dataDir>/sessions/<id>.json, <dataDir>/messages/<id>.json,
 *  <dataDir>/parts/<id>.json — whole-document writes (sessions are small). */
type JsonlStoreOptions = {
    dataDir: string;
};
export declare function createJsonlSessionStore(options: JsonlStoreOptions): SessionStore;
export {};
//# sourceMappingURL=jsonl-store.d.ts.map