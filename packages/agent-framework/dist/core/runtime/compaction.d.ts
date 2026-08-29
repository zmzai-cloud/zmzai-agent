import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
/** Framework compaction (spec §8.3) — projection style (tutorial-advanced 06):
 *  canonical history (PI state.messages) is never mutated; the transform keeps
 *  closure state {anchor, summary} and projects the model's view as
 *  [summaryMessage, ...messages.slice(anchor)]. PI's transformContext result is
 *  request-only (never written back to state), so the previous stateless
 *  version re-summarized the whole history on every LLM request — the anchor
 *  turns compaction into an incremental, idempotent projection.
 *  Known limitation: closure state lives per-run (the runner builds a fresh
 *  transform for each runLoop), so a new run re-summarizes once when it next
 *  crosses the threshold; cross-run persistence belongs in the store later.
 *
 *  Harness-course retrofits (tutorial-harness 05/07) preserved:
 *  - 膨胀拒绝：新摘要比它替代的内容（新折叠段 + 旧摘要）还长时作废本次压缩。
 *  - 失败记忆：摘要调用失败或膨胀后，本轮不再反复烧摘要 token。
 *  Projection retrofit adds (tutorial-advanced 06):
 *  - 滞回带：已有摘要时，只有投影尾部自上次压缩后长够摘要体量的一半才再压，
 *    防止超窗后每个请求都重摘一遍。
 *  - 增量摘要：摘要提示词带【已有摘要】+ 新折叠段，反复压缩是续写不是重启。
 *  - 摘要消息固定 timestamp: 0：投影前缀跨请求逐字节稳定，provider 的
 *    prompt cache（前缀逐字节匹配）在两次压缩之间持续命中。 */
export type CompactionOptions = {
    /** Cheap model used to write the summary (the relay's small model). */
    summaryModel: Model<Api>;
    /** Main model's context window (tokens). */
    contextWindow: number;
    /** Reserve headroom for the summary prompt + next reply. */
    reserveTokens?: number;
    /** How many recent messages to keep verbatim. */
    keepRecentMessages?: number;
    /** Streams one completion from the summary model. */
    streamSummary: (messages: AgentMessage[]) => Promise<string>;
    /** Called when a compaction happens so the runner can emit the part. */
    onCompacted?: (summary: string, tokensBefore: number) => void;
    /** Called when a compaction attempt fails ("summary-empty" | "summary-inflated");
     *  after any failure the transform stops retrying for this run (失败记忆). */
    onCompactionFailed?: (reason: "summary-empty" | "summary-inflated") => void | Promise<void>;
    /** 无条件压缩（UI「压缩当前会话」）：跳过阈值与滞回早退，其余保护（膨胀拒绝等）不变。 */
    force?: boolean;
};
/** Returns a transformContext that projects the model's view as
 *  [summaryMessage?, ...messages.slice(anchor)] and compacts incrementally
 *  when the projection crosses the window. */
export declare function createCompactionTransform(options: CompactionOptions): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
/** One-shot completion via an AssistantMessageEventStream (relay streamFn
 *  shape): drives the stream to completion and returns its full text. Used for
 *  summary generation and async title generation (spec §13.2). */
export declare function streamOneText(streamFn: (model: Model<Api>, context: {
    systemPrompt: string;
    messages: AgentMessage[];
}) => Promise<{
    result(): Promise<{
        content?: unknown;
    }>;
}> | {
    result(): Promise<{
        content?: unknown;
    }>;
}, model: Model<Api>, systemPrompt: string, messages: AgentMessage[]): Promise<string>;
/** Builds the compaction transform for a run from a relay stream fn + model
 *  refs. Returns undefined when compaction is disabled (no summaryModel). */
export declare function buildCompactionTransform(input: {
    enabled: boolean;
    contextWindow: number;
    summaryModel: Model<Api> | null;
    streamOne: (model: Model<Api>, messages: AgentMessage[]) => Promise<string>;
    onCompacted?: (summary: string, tokensBefore: number) => void;
    force?: boolean;
}): ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>) | undefined;
//# sourceMappingURL=compaction.d.ts.map