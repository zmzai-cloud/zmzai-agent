import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { AgentRegistry, type AgentInfo } from "../agent/registry.js";
import type { AgentResolver } from "../agent/resolver.js";
import { type EventLog } from "../events/bus.js";
import { PermissionEngine, type Reply } from "../permission/engine.js";
import type { Ruleset } from "../permission/ruleset.js";
import type { SessionStore } from "../session/store.js";
import type { ModelRef, SessionInfo, ThinkingEffort } from "../session/types.js";
import type { ToolContext, WorkspaceFiles } from "../tools/context.js";
import type { AnyToolDef } from "../tools/def.js";
import { type LifecycleHook } from "./lifecycle.js";
import type { SandboxExecutor } from "../../adapters/index.js";
/** SessionRunner (spec §8.1): owns one session's full lifecycle — prompt →
 *  PI agent loop → persisted parts + framework events → terminal settlement
 *  → queued prompt continuation. Permission checks happen only in
 *  beforeToolCall (spec §5.4).
 *
 *  M5: fully storage/backend-agnostic. All product surfaces (model, sandbox,
 *  workspace files, event log, lease) are injected. */
export type { ThinkingEffort } from "../session/types.js";
export type PromptInput = {
    text: string;
    agent?: string;
    model?: ModelRef;
    images?: readonly {
        url: string;
        mediaType: string;
    }[];
    effort?: ThinkingEffort;
};
export type RunnerDeps = {
    store: SessionStore;
    registry: AgentRegistry;
    /** Built per run so multi-tenant deployments bind the right billing
     *  identity (relay stream is keyed by userId). */
    streamFnFor: (session: SessionInfo) => ConstructorParameters<typeof Agent>[0]["streamFn"];
    modelFor: (ref: ModelRef) => Model<Api>;
    /** Durable event log (framework events). Product supplies Mongo; package
     *  ships in-memory/JSONL. */
    eventLog: EventLog;
    /** Workspace file backend. Product supplies Mongo; package ships FS/JSONL. */
    workspaceFor: (session: SessionInfo) => WorkspaceFiles;
    /** Isolated command execution. Product supplies OpenSandbox; package ships a
     *  subprocess reference implementation. */
    sandbox?: SandboxExecutor;
    /** Lease store (runner stamps while owning a run). */
    leaseStore?: {
        stamp(sessionId: string, owner: string, expiresAt: Date): Promise<void>;
        clear(sessionId: string): Promise<void>;
    };
    /** Product approval sessions may persist an "always" rule with a bounded
     * lifetime. The in-memory rule remains valid for the current run. */
    sessionRuleTtlMs?: number;
    tools?: AnyToolDef[];
    /** 本机工具（用户桌面机器上的 fs/shell/notify）。产品经 relay → bridge 下发
     *  到桌面客户端，客户端本地审批后执行。与 sandbox 的云端执行相互独立。
     *  MCP server 工具（ExternalToolDef）也走这里注入。 */
    localTools?: AnyToolDef[];
    buildToolContext?: (input: {
        session: SessionInfo;
        engine: PermissionEngine;
    }) => ToolContext;
    /** Loads workspace custom agents (spec §6.3). */
    loadWorkspaceAgents?: (session: SessionInfo) => Promise<AgentInfo[]>;
    /** Optional control-plane lookup for an immutable Agent Version. */
    agentResolver?: AgentResolver;
    /** Max subagent nesting depth (spec §6.4, default 1). */
    subagentDepth: number;
    /** Auto-compaction (spec §8.3). Disabled when summaryModel is null. */
    compaction?: {
        enabled: boolean;
        contextWindow: number;
        summaryModel: Model<Api> | null;
    };
    /** 生命周期钩子（P0）：observe/block。抛错只告警不中断运行。 */
    hooks?: LifecycleHook[];
    /** 长期记忆召回（spec §记忆）：run 开始时按当前 prompt 查询，返回文本
     *  则作为首条 in-memory user 消息前插（不落 store）。抛错/返回空时零影响。 */
    memoryContextFor?: (session: SessionInfo, text: string) => Promise<string | undefined>;
};
/** 上游中断类错误（F6）：模型流偶发终止/连接断开时自动重试一次，避免
 *  偶发中断直接结束任务（实测 relay 透传 "terminated"、上游断流
 *  "upstream_http2_stream_error" 等）。余额/鉴权等确定性错误不重试。 */
export declare function isRetryableError(message: string): boolean;
export declare class SessionRunner {
    #private;
    private readonly deps;
    constructor(deps: RunnerDeps);
    /** 供 runLoop 取归一化钩子数组（lazy：constructor 后仍可由 deps 引用共享）。 */
    private get hooks();
    /** fallbackSessionId 由 runLoop 闭包传入（而非实例字段）：runner 是进程级
     *  单例，两个会话并发时实例字段会互相覆盖，导致 message.part.delta 等
     *  无自带 sessionId 的事件落到错误的会话事件流里（串台）。 */
    private persist;
    private publish;
    private stampLease;
    private clearLease;
    prompt(sessionId: string, input: PromptInput): Promise<{
        queued: boolean;
    }>;
    replyPermission(sessionId: string, requestId: string, reply: Reply, feedback?: string): Promise<boolean>;
    /** Revokes matching session-scoped rules immediately for a live run and
     * removes their persisted continuation access. */
    revokePermission(sessionId: string, permission: string, patterns: string[]): Promise<boolean>;
    abort(sessionId: string): Promise<void>;
    /** 手动触发一次上下文压缩（UI「压缩当前会话」）：无条件对当前历史跑一次
     *  摘要折叠，摘要通过 buildCompaction 的 onCompacted 落为 compaction part
     *  并发事件。与自动 compaction 共用同一套保护（膨胀拒绝/失败降级）。 */
    compactSession(sessionId: string): Promise<{
        ok: boolean;
        reason?: string;
    }>;
    /** Builds the compaction transformContext (spec §8.3) when the runner has a
     *  summary model configured. Emits a `compaction` part on the latest
     *  assistant message so the boundary shows in the transcript. force=true
     *  skips the threshold/滞回 early-outs (手动「压缩当前会话」). */
    private buildCompaction;
    /** Layers the session's workspace custom agents (`.zmzai/agents/*.md`) on top
     *  of the shared registry without mutating it (spec §6.3). Load failures
     *  degrade to the base registry — a malformed md never blocks a run. */
    private registryFor;
    /** Versioned agents are resolved from the product control plane. A missing
     *  version intentionally falls back to the M1-M5 registry so old sessions
     *  and standalone consumers remain valid. */
    private resolvedAgentFor;
    private runLoop;
    /** Spawns a subagent child session (spec §6.4): depth-capped, permission
     *  stamped from parent session + subagent preset, runs a nested PI loop to
     *  completion, and returns the child's final assistant text as the parent
     *  tool's result. Awaits the nested runLoop directly. */
    private spawnSubagent;
    /** Persists a subtask part on the parent's latest assistant message so the
     *  transcript links to the child session (spec §6.4 step 5). */
    private recordSubtask;
    private lastAssistantText;
    private sessionDepth;
    private rebuildMessages;
}
export declare function createFrameworkSession(input: {
    store: SessionStore;
    id?: string;
    userId: string;
    workspaceId: string;
    agent?: string;
    agentId?: string;
    agentVersionId?: string;
    model: ModelRef;
    prompt?: string;
    parentId?: string;
    title?: string;
    permission?: Ruleset;
    writePaths?: string[];
}): Promise<SessionInfo>;
export declare function isSessionActive(sessionId: string): boolean;
//# sourceMappingURL=runner.d.ts.map