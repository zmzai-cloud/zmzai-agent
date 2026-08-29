import { z } from "zod";
import type { MessageInfo, Part, SessionInfo } from "../session/types.js";
export declare const sessionInfoSchema: z.ZodType<SessionInfo>;
export declare const messageInfoSchema: z.ZodCustom<MessageInfo, MessageInfo>;
export declare const partSchema: z.ZodCustom<Part, Part>;
declare const todoItemSchema: z.ZodObject<{
    content: z.ZodString;
    status: z.ZodEnum<{
        pending: "pending";
        completed: "completed";
        in_progress: "in_progress";
        cancelled: "cancelled";
    }>;
    priority: z.ZodOptional<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
    }>>;
}, z.core.$strip>;
export declare const frameworkEventSchemas: {
    readonly "session.updated": z.ZodObject<{
        session: z.ZodType<SessionInfo, unknown, z.core.$ZodTypeInternals<SessionInfo, unknown>>;
    }, z.core.$strip>;
    readonly "session.status": z.ZodObject<{
        status: z.ZodEnum<{
            running: "running";
            idle: "idle";
            waiting_permission: "waiting_permission";
            waiting_input: "waiting_input";
        }>;
    }, z.core.$strip>;
    readonly "session.error": z.ZodObject<{
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>;
    readonly "message.updated": z.ZodObject<{
        message: z.ZodCustom<MessageInfo, MessageInfo>;
    }, z.core.$strip>;
    readonly "message.part.updated": z.ZodObject<{
        part: z.ZodCustom<Part, Part>;
    }, z.core.$strip>;
    readonly "message.part.delta": z.ZodObject<{
        messageId: z.ZodString;
        partId: z.ZodString;
        field: z.ZodLiteral<"text">;
        delta: z.ZodString;
    }, z.core.$strip>;
    readonly "permission.asked": z.ZodObject<{
        request: z.ZodObject<{
            id: z.ZodString;
            sessionId: z.ZodString;
            permission: z.ZodString;
            patterns: z.ZodArray<z.ZodString>;
            metadata: z.ZodOptional<z.ZodUnknown>;
            always: z.ZodArray<z.ZodString>;
            tool: z.ZodOptional<z.ZodObject<{
                messageId: z.ZodString;
                callId: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly "permission.replied": z.ZodObject<{
        id: z.ZodString;
        reply: z.ZodEnum<{
            once: "once";
            always: "always";
            reject: "reject";
        }>;
    }, z.core.$strip>;
    readonly "todo.updated": z.ZodObject<{
        todos: z.ZodArray<z.ZodObject<{
            content: z.ZodString;
            status: z.ZodEnum<{
                pending: "pending";
                completed: "completed";
                in_progress: "in_progress";
                cancelled: "cancelled";
            }>;
            priority: z.ZodOptional<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly "file.edited": z.ZodObject<{
        path: z.ZodString;
        revisionId: z.ZodString;
        diff: z.ZodString;
    }, z.core.$strip>;
    readonly "artifact.created": z.ZodObject<{
        artifactId: z.ZodString;
        path: z.ZodString;
        bytes: z.ZodNumber;
        contentType: z.ZodString;
        downloadUrl: z.ZodString;
        previewUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
};
export type FrameworkEventType = keyof typeof frameworkEventSchemas;
export type FrameworkEvent = {
    [K in FrameworkEventType]: {
        type: K;
        data: z.infer<(typeof frameworkEventSchemas)[K]>;
    };
}[FrameworkEventType];
export type PersistedFrameworkEvent = FrameworkEvent & {
    id: string;
    sessionId: string;
    seq: number;
    at: string;
};
export type TodoItem = z.infer<typeof todoItemSchema>;
/** Narrows an unknown payload (e.g. from an SSE frame) to a FrameworkEvent. */
export declare function parseFrameworkEvent(value: unknown): FrameworkEvent | null;
export {};
//# sourceMappingURL=manifest.d.ts.map