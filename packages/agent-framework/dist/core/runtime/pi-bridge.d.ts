import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FrameworkEvent } from "../events/manifest.js";
import type { MessageInfo, ModelRef } from "../session/types.js";
/** Part-projector (spec §8.2): folds PI agent events into the persisted
 *  Message/Part graph and the framework events to publish. Pure and sync —
 *  the runner feeds PI events one by one and drains the output queue. */
export type BridgeIdentity = {
    sessionId: string;
    agent: string;
    model: ModelRef;
};
type Emit = (event: FrameworkEvent) => void;
/** Serializes the emitted events through an async sink while preserving order:
 *  handler calls stay sync, persistence/publish fan-out happens in a chained
 *  promise so PI's awaited subscribers never observe reordering. */
export declare function serializeEmit(sink: (event: FrameworkEvent) => Promise<void>): {
    emit: Emit;
    settled: () => Promise<void>;
};
export declare class PartProjector {
    private readonly identity;
    private userMessageId;
    private assistantMessageId;
    private readonly parts;
    private readonly textByContent;
    private readonly reasoningByContent;
    private readonly toolPartByCallId;
    private stepOpen;
    private stepCounter;
    /** Tools belong to the assistant message that requested them. PI emits
     *  message_end(assistant) before that turn's tool executions, so the tool
     *  parts anchor here instead of the (already cleared) current message. */
    private toolAnchorMessageId;
    /** Exposed for the runner's permission hook (permission requests carry the
     *  originating message id). */
    get currentAssistantMessageId(): string | null;
    constructor(identity: BridgeIdentity);
    private emitPart;
    private patchPart;
    private flushText;
    private flushAllText;
    private assistantPart;
    onUserPrompt(emit: Emit, text: string, images?: readonly {
        url: string;
        mediaType: string;
    }[]): MessageInfo;
    onAssistantStart(emit: Emit): void;
    onTextDelta(emit: Emit, contentIndex: number, delta: string): void;
    onThinkingDelta(emit: Emit, contentIndex: number, delta: string): void;
    onToolExecutionStart(emit: Emit, toolCallId: string, toolName: string, args: unknown, label?: string): void;
    onToolExecutionUpdate(emit: Emit, toolCallId: string, partial: unknown): void;
    onToolExecutionEnd(emit: Emit, toolCallId: string, result: unknown, isError: boolean): void;
    onAssistantEnd(emit: Emit, message: AgentMessage): void;
}
export {};
//# sourceMappingURL=pi-bridge.d.ts.map