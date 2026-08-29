import { z } from "zod";
/** Framework event manifest (spec §4.2) — the frozen v0 wire contract.
 *  Every event is persisted to fw_events with a per-session ascending seq and
 *  can be replayed via subscribe(sinceSeq). */
const modelRefSchema = z.object({ providerId: z.string(), modelId: z.string() });
const rulesetSchema = z.array(z.object({ permission: z.string(), pattern: z.string(), action: z.enum(["allow", "deny", "ask"]) }));
export const sessionInfoSchema = z.object({
    id: z.string(),
    workspaceId: z.string(),
    userId: z.string(),
    parentId: z.string().optional(),
    title: z.string(),
    agent: z.string(),
    model: modelRefSchema,
    permission: rulesetSchema,
    queuedPrompts: z.array(z.object({ text: z.string(), agent: z.string().optional(), enqueuedAt: z.string() })),
    time: z.object({ created: z.string(), updated: z.string(), archived: z.string().optional() }),
});
export const messageInfoSchema = z.custom((value) => typeof value === "object" &&
    value !== null &&
    "role" in value &&
    (value.role === "user" || value.role === "assistant"), "invalid MessageInfo");
export const partSchema = z.custom((value) => typeof value === "object" && value !== null && "type" in value && typeof value.type === "string", "invalid Part");
const permissionRequestSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    permission: z.string(),
    patterns: z.array(z.string()),
    metadata: z.unknown().optional(),
    always: z.array(z.string()),
    tool: z.object({ messageId: z.string(), callId: z.string() }).optional(),
});
const todoItemSchema = z.object({
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["high", "medium", "low"]).optional(),
});
export const frameworkEventSchemas = {
    "session.updated": z.object({ session: sessionInfoSchema }),
    "session.status": z.object({ status: z.enum(["idle", "running", "waiting_permission", "waiting_input"]) }),
    "session.error": z.object({ name: z.string(), message: z.string() }),
    "message.updated": z.object({ message: messageInfoSchema }),
    "message.part.updated": z.object({ part: partSchema }),
    "message.part.delta": z.object({ messageId: z.string(), partId: z.string(), field: z.literal("text"), delta: z.string() }),
    "permission.asked": z.object({ request: permissionRequestSchema }),
    "permission.replied": z.object({ id: z.string(), reply: z.enum(["once", "always", "reject"]) }),
    "todo.updated": z.object({ todos: z.array(todoItemSchema) }),
    "file.edited": z.object({ path: z.string(), revisionId: z.string(), diff: z.string() }),
    "artifact.created": z.object({
        artifactId: z.string(),
        path: z.string(),
        bytes: z.number(),
        contentType: z.string(),
        downloadUrl: z.string(),
        previewUrl: z.string().optional(),
    }),
};
/** Narrows an unknown payload (e.g. from an SSE frame) to a FrameworkEvent. */
export function parseFrameworkEvent(value) {
    if (typeof value !== "object" || value === null)
        return null;
    const { type, data } = value;
    if (typeof type !== "string" || !(type in frameworkEventSchemas))
        return null;
    const schema = frameworkEventSchemas[type];
    const parsed = schema.safeParse(data);
    return parsed.success ? { type, data: parsed.data } : null;
}
//# sourceMappingURL=manifest.js.map