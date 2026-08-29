import { type Action, type Ruleset } from "../permission/ruleset.js";
/** Permission engine (spec §5.2/§5.3). The single choke point for every
 *  dangerous operation: SessionRunner wires `ask()` into PI's beforeToolCall.
 *
 *  - allow-all patterns short-circuit without emitting any event
 *  - otherwise a PermissionRequest is published (`permission.asked`) and the
 *    caller is suspended on a Deferred until `reply()` resolves it
 *  - "always" stamps an allow rule onto the session ruleset and auto-resolves
 *    other pending requests in the same session now covered by it
 *  - "reject" throws RejectedError back into the tool call (fed to the model)
 */
export type Reply = "once" | "always" | "reject";
export type PermissionRequest = {
    id: string;
    sessionId: string;
    permission: string;
    patterns: string[];
    metadata?: unknown;
    always: string[];
    tool?: {
        messageId: string;
        callId: string;
    };
};
export declare class RejectedError extends Error {
    readonly feedback?: string | undefined;
    constructor(message: string, feedback?: string | undefined);
}
export type AskInput = {
    sessionId: string;
    permission: string;
    patterns: string[];
    metadata?: unknown;
    always?: string[];
    tool?: {
        messageId: string;
        callId: string;
    };
};
export type PermissionEngineOptions = {
    /** Called after a request is created; typically publishes permission.asked. */
    onAsked?: (request: PermissionRequest) => void | Promise<void>;
    /** Called when a request resolves; typically publishes permission.replied. */
    onReplied?: (request: PermissionRequest, reply: Reply) => void | Promise<void>;
    /** Persist a session-scoped rule produced by an "always" reply. */
    onSessionRuleAdded?: (sessionId: string, rule: {
        permission: string;
        pattern: string;
        action: Action;
    }) => void | Promise<void>;
};
export declare class PermissionEngine {
    private readonly sessionId;
    private readonly options;
    /** Rulesets in ascending precedence: built-in defaults → agent preset → session. */
    private readonly rulesets;
    private readonly sessionRules;
    private readonly pending;
    private disposed;
    /** 临时允许缓存：once 批准后同一 run 内相同模式直接放行（F1，避免 Agent
     *  二次调用相同命令时重复打断用户）。run 结束（dispose）时清空，下次 run
     *  重新询问。键 = permission + pattern（bash 的 pattern 即命令原文）。 */
    private readonly onceAllowed;
    constructor(sessionId: string, baseRulesets: Ruleset[], sessionRules?: Ruleset, options?: PermissionEngineOptions);
    private onceKey;
    evaluate(permission: string, pattern: string): Action;
    /** Snapshot of the effective session rules (for persistence on reply "always"). */
    get sessionRuleset(): Ruleset;
    revoke(permission: string, patterns: string[]): boolean;
    get pendingRequests(): PermissionRequest[];
    ask(input: AskInput): Promise<Reply>;
    /** Resolves a pending request. Returns false when the id is unknown (already
     *  resolved or session restarted — callers map that to a 404/conflict).
     *
     *  Harness-course retrofit（tutorial-harness 08，OpenCode 拒绝级联）：用户拒绝一个
     *  请求时，同会话排队中的其他待批请求一并拒绝——用户说“不”的时候，
     *  不该让后面的请求继续敲门。批准不连坐，拒绝连坐。 */
    reply(requestId: string, reply: Reply, feedback?: string): boolean;
    /** Rejects everything still pending — used on abort and process teardown so
     *  tool calls never hang forever (spec §5.4: restart semantics). Also clears
     *  the once-allowed cache so the next run asks again. */
    dispose(reason?: string): void;
}
//# sourceMappingURL=engine.d.ts.map