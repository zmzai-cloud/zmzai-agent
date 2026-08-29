import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
export function createSqliteSessionStore(options) {
    const { dataDir } = options;
    mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, "zmzai.db"));
    // WAL：读写互不阻塞；busy_timeout：另一进程持写锁时本连接等待而非立即 SQLITE_BUSY
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      updated TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, created);
    CREATE INDEX IF NOT EXISTS idx_parts_message ON parts (message_id);
  `);
    // ---- 旧 JSONL 一次性导入（幂等：仅当库为空且旧目录有数据） ----
    if (options.importJsonl !== false && db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n === 0) {
        for (const [dir, table] of [
            ["sessions", "sessions"],
            ["messages", "messages"],
            ["parts", "parts"],
        ]) {
            const abs = path.join(dataDir, dir);
            if (!existsSync(abs))
                continue;
            for (const file of readdirSync(abs)) {
                if (!file.endsWith(".json"))
                    continue;
                try {
                    const record = JSON.parse(readFileSync(path.join(abs, file), "utf8"));
                    upsert(table, record);
                }
                catch {
                    // skip corrupt files
                }
            }
        }
    }
    function upsert(table, record) {
        if (table === "sessions") {
            const s = record;
            db.prepare("INSERT INTO sessions (id, user_id, workspace_id, updated, json) VALUES (?, ?, ?, ?, ?) " +
                "ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, workspace_id = excluded.workspace_id, updated = excluded.updated, json = excluded.json").run(s.id, s.userId, s.workspaceId, s.time.updated, JSON.stringify(s));
        }
        else if (table === "messages") {
            const m = record;
            db.prepare("INSERT INTO messages (id, session_id, created, json) VALUES (?, ?, ?, ?) " +
                "ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(m.id, m.sessionId, m.time.created, JSON.stringify(m));
        }
        else {
            const p = record;
            db.prepare("INSERT INTO parts (id, session_id, message_id, json) VALUES (?, ?, ?, ?) " +
                "ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(p.id, p.sessionId, p.messageId, JSON.stringify(p));
        }
    }
    function getSessionRow(id) {
        const row = db.prepare("SELECT json FROM sessions WHERE id = ?").get(id);
        return row ? JSON.parse(row.json) : null;
    }
    function persistSession(session) {
        upsert("sessions", session);
    }
    return {
        async createSession(info) {
            persistSession(info);
        },
        async getSession(id) {
            const session = getSessionRow(id);
            return session ? structuredClone(session) : null;
        },
        async updateSession(id, patch) {
            const session = getSessionRow(id);
            if (!session)
                return;
            const updated = { ...session, ...patch, time: { ...session.time, ...(patch.time ?? {}), updated: new Date().toISOString() } };
            persistSession(updated);
        },
        async listSessions(filter) {
            const rows = db
                .prepare("SELECT json FROM sessions WHERE user_id = ? AND (? IS NULL OR workspace_id = ?) ORDER BY updated DESC")
                .all(filter.userId, filter.workspaceId ?? null, filter.workspaceId ?? null);
            return rows.map((row) => JSON.parse(row.json));
        },
        async appendMessage(info) {
            upsert("messages", info);
        },
        async updateMessage(id, patch) {
            const row = db.prepare("SELECT json FROM messages WHERE id = ?").get(id);
            if (!row)
                return;
            const updated = { ...JSON.parse(row.json), ...patch };
            upsert("messages", updated);
        },
        async appendPart(part) {
            upsert("parts", part);
        },
        async updatePart(part) {
            upsert("parts", part);
        },
        async getMessages(sessionId) {
            const messageRows = db
                .prepare("SELECT json FROM messages WHERE session_id = ? ORDER BY created ASC")
                .all(sessionId);
            const partRows = db
                .prepare("SELECT message_id, json FROM parts WHERE session_id = ?")
                .all(sessionId);
            const partsByMessage = new Map();
            for (const row of partRows) {
                const list = partsByMessage.get(row.message_id) ?? [];
                list.push(JSON.parse(row.json));
                partsByMessage.set(row.message_id, list);
            }
            return messageRows.map((row) => {
                const info = JSON.parse(row.json);
                return { info, parts: partsByMessage.get(info.id) ?? [] };
            });
        },
        async enqueuePrompt(sessionId, prompt) {
            const session = getSessionRow(sessionId);
            if (!session)
                return 0;
            session.queuedPrompts.push(prompt);
            persistSession(session);
            return session.queuedPrompts.length;
        },
        async dequeuePrompt(sessionId) {
            const session = getSessionRow(sessionId);
            const next = session?.queuedPrompts.shift();
            if (session && next)
                persistSession(session);
            return next ?? null;
        },
        async clearQueuedPrompts(sessionId) {
            const session = getSessionRow(sessionId);
            if (!session)
                return;
            session.queuedPrompts = [];
            persistSession(session);
        },
    };
}
//# sourceMappingURL=sqlite-store.js.map