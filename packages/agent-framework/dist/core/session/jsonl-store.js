import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
export function createJsonlSessionStore(options) {
    const { dataDir } = options;
    const sessionsDir = path.join(dataDir, "sessions");
    const messagesDir = path.join(dataDir, "messages");
    const partsDir = path.join(dataDir, "parts");
    async function ensureDirs() {
        await mkdir(sessionsDir, { recursive: true });
        await mkdir(messagesDir, { recursive: true });
        await mkdir(partsDir, { recursive: true });
    }
    const sessions = new Map();
    const messages = new Map();
    const parts = new Map();
    let hydrated = false;
    async function hydrate() {
        if (hydrated)
            return;
        await ensureDirs();
        const { readdir } = await import("node:fs/promises");
        for (const [dir, map] of [
            [sessionsDir, sessions],
            [messagesDir, messages],
            [partsDir, parts],
        ]) {
            if (!existsSync(dir))
                continue;
            for (const file of await readdir(dir)) {
                if (!file.endsWith(".json"))
                    continue;
                try {
                    const record = JSON.parse(await readFile(path.join(dir, file), "utf8"));
                    const id = ("sessionId" in record && file.startsWith("ses_")) || file.startsWith("ses_") ? record.id : record.id;
                    if (id)
                        map.set(id, record);
                }
                catch {
                    // skip corrupt files
                }
            }
        }
        hydrated = true;
    }
    async function persist(dir, record) {
        await ensureDirs();
        await writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), "utf8");
    }
    return {
        async createSession(info) {
            await hydrate();
            sessions.set(info.id, structuredClone(info));
            await persist(sessionsDir, info);
        },
        async getSession(id) {
            await hydrate();
            const session = sessions.get(id);
            return session ? structuredClone(session) : null;
        },
        async updateSession(id, patch) {
            await hydrate();
            const session = sessions.get(id);
            if (!session)
                return;
            const updated = { ...session, ...patch, time: { ...session.time, ...(patch.time ?? {}), updated: new Date().toISOString() } };
            sessions.set(id, updated);
            await persist(sessionsDir, updated);
        },
        async listSessions(filter) {
            await hydrate();
            return [...sessions.values()]
                .filter((session) => session.userId === filter.userId && (!filter.workspaceId || session.workspaceId === filter.workspaceId))
                .sort((a, b) => b.time.updated.localeCompare(a.time.updated))
                .map((session) => structuredClone(session));
        },
        async appendMessage(info) {
            await hydrate();
            messages.set(info.id, structuredClone(info));
            await persist(messagesDir, info);
        },
        async updateMessage(id, patch) {
            await hydrate();
            const message = messages.get(id);
            if (!message)
                return;
            const updated = { ...message, ...patch };
            messages.set(id, updated);
            await persist(messagesDir, updated);
        },
        async appendPart(part) {
            await hydrate();
            parts.set(part.id, structuredClone(part));
            await persist(partsDir, part);
        },
        async updatePart(part) {
            await hydrate();
            parts.set(part.id, structuredClone(part));
            await persist(partsDir, part);
        },
        async getMessages(sessionId) {
            await hydrate();
            const result = [];
            for (const message of messages.values()) {
                if (message.sessionId !== sessionId)
                    continue;
                result.push({
                    info: structuredClone(message),
                    parts: [...parts.values()].filter((part) => part.messageId === message.id).map((part) => structuredClone(part)),
                });
            }
            result.sort((a, b) => a.info.time.created.localeCompare(b.info.time.created));
            return result;
        },
        async enqueuePrompt(sessionId, prompt) {
            await hydrate();
            const session = sessions.get(sessionId);
            if (!session)
                return 0;
            session.queuedPrompts.push(prompt);
            await persist(sessionsDir, session);
            return session.queuedPrompts.length;
        },
        async dequeuePrompt(sessionId) {
            await hydrate();
            const session = sessions.get(sessionId);
            const next = session?.queuedPrompts.shift();
            if (session && next)
                await persist(sessionsDir, session);
            return next ?? null;
        },
        async clearQueuedPrompts(sessionId) {
            await hydrate();
            const session = sessions.get(sessionId);
            if (!session)
                return;
            session.queuedPrompts = [];
            await persist(sessionsDir, session);
        },
    };
}
//# sourceMappingURL=jsonl-store.js.map