import type { AgentTool } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import type { ToolContext } from "../tools/context.js";
import type { AnyToolDef, ExternalToolDef, ToolDef } from "../tools/def.js";
/** Repairs common OpenAI-compatible tool-argument transport defects without
 * inventing values: JSON encoded once/twice as a string, markdown fences, and
 * missing container closers after a stream cut. */
export declare function repairToolArguments(raw: unknown): unknown;
/** 超限时保留 head + tail，中间换成裁剪标记（带省略字节/行数）；
 *  按字节预算裁到字符边界，不会切碎多字节字符。 */
export declare function pruneOutput(text: string): {
    text: string;
    truncated: boolean;
    omittedBytes: number;
};
/** Adapts a framework ToolDef into a PI AgentTool (spec §7.1):
 *  - zod parameters are bridged to JSON Schema (typebox-compatible) via
 *    zod's built-in toJSONSchema; args are re-validated with zod inside
 *    execute so friendly parse errors feed back to the model
 *  - output is truncated and the truncation recorded in details
 *  - thrown errors propagate (PI converts them to error tool results)
 *
 *  Permission checks are NOT done here — the runner evaluates
 *  `def.permission(args)` in beforeToolCall so every tool call passes the
 *  single choke point before execute() runs. */
export declare function adaptTool<TSchema extends z.ZodType>(def: ToolDef<TSchema>, ctx: ToolContext): AgentTool;
/** External (JSON Schema) tools reuse the same prune/wrap pipeline; args pass
 *  through unvalidated — the remote tool owns its schema contract. */
export declare function adaptExternalTool(def: ExternalToolDef, ctx: ToolContext): AgentTool;
/** Adapts either tool flavor into a PI AgentTool. */
export declare function adaptAnyTool(def: AnyToolDef, ctx: ToolContext): AgentTool;
/** Maps a tool call to its permission request — used by the runner's
 *  beforeToolCall hook. */
export declare function permissionForCall(defs: Map<string, AnyToolDef>, toolName: string, args: unknown): {
    permission: string;
    patterns: string[];
    always?: string[];
    metadata?: unknown;
} | null;
//# sourceMappingURL=adapter.d.ts.map