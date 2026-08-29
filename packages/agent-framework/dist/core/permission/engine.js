import { newPermissionRequestId } from "../session/ids.js";
import { evaluateRules } from "../permission/ruleset.js";
export class RejectedError extends Error {
    feedback;
    constructor(message, feedback) {
        super(feedback ? `${message}（用户反馈：${feedback}）` : message);
        this.feedback = feedback;
        this.name = "RejectedError";
    }
}
export class PermissionEngine {
    sessionId;
    options;
    /** Rulesets in ascending precedence: built-in defaults → agent preset → session. */
    rulesets;
    sessionRules = [];
    pending = new Map();
    disposed = false;
    /** 临时允许缓存：once 批准后同一 run 内相同模式直接放行（F1，避免 Agent
     *  二次调用相同命令时重复打断用户）。run 结束（dispose）时清空，下次 run
     *  重新询问。键 = permission + pattern（bash 的 pattern 即命令原文）。 */
    onceAllowed = new Set();
    constructor(sessionId, baseRulesets, sessionRules = [], options = {}) {
        this.sessionId = sessionId;
        this.options = options;
        this.rulesets = [...baseRulesets, this.sessionRules];
        this.sessionRules.push(...sessionRules);
    }
    onceKey(permission, pattern) {
        return `${permission}\u0000${pattern}`;
    }
    evaluate(permission, pattern) {
        return evaluateRules(this.rulesets, permission, pattern);
    }
    /** Snapshot of the effective session rules (for persistence on reply "always"). */
    get sessionRuleset() {
        return [...this.sessionRules];
    }
    revoke(permission, patterns) {
        const before = this.sessionRules.length;
        const patternSet = new Set(patterns);
        const retained = this.sessionRules.filter((rule) => !(rule.permission === permission && patternSet.has(rule.pattern)));
        this.sessionRules.splice(0, this.sessionRules.length, ...retained);
        return retained.length !== before;
    }
    get pendingRequests() {
        return [...this.pending.values()].map((entry) => entry.request);
    }
    async ask(input) {
        if (this.disposed)
            throw new RejectedError("权限引擎已关闭（服务重启或会话结束），请重试");
        const patterns = input.patterns.length ? input.patterns : ["*"];
        // 已 once 批准的相同模式直接放行，不重复询问。
        const undecided = patterns.filter((pattern) => this.evaluate(input.permission, pattern) !== "allow" && !this.onceAllowed.has(this.onceKey(input.permission, pattern)));
        if (undecided.length === 0)
            return "once";
        const request = {
            id: newPermissionRequestId(),
            sessionId: input.sessionId,
            permission: input.permission,
            patterns: undecided,
            ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            always: input.always ?? [...undecided],
            ...(input.tool ? { tool: input.tool } : {}),
        };
        const decision = new Promise((resolve) => {
            this.pending.set(request.id, { request, resolve });
        });
        await this.options.onAsked?.(request);
        const { reply, feedback } = await decision;
        await this.options.onReplied?.(request, reply);
        if (reply === "reject") {
            throw new RejectedError(`权限被拒绝：${input.permission} ${undecided.join(", ")}`, feedback);
        }
        if (reply === "once") {
            // F1：本 run 内相同命令/模式不再询问。
            for (const pattern of request.patterns)
                this.onceAllowed.add(this.onceKey(input.permission, pattern));
        }
        if (reply === "always") {
            for (const pattern of request.always) {
                const rule = { permission: input.permission, pattern, action: "allow" };
                this.sessionRules.push(rule);
                await this.options.onSessionRuleAdded?.(input.sessionId, rule);
            }
            // Auto-resolve other pending requests in this session now fully covered.
            for (const [id, entry] of [...this.pending]) {
                const covered = entry.request.patterns.every((pattern) => this.evaluate(entry.request.permission, pattern) === "allow");
                if (covered) {
                    this.pending.delete(id);
                    entry.resolve({ reply: "always" });
                    await this.options.onReplied?.(entry.request, "always");
                }
            }
        }
        return reply;
    }
    /** Resolves a pending request. Returns false when the id is unknown (already
     *  resolved or session restarted — callers map that to a 404/conflict).
     *
     *  Harness-course retrofit（tutorial-harness 08，OpenCode 拒绝级联）：用户拒绝一个
     *  请求时，同会话排队中的其他待批请求一并拒绝——用户说“不”的时候，
     *  不该让后面的请求继续敲门。批准不连坐，拒绝连坐。 */
    reply(requestId, reply, feedback) {
        const entry = this.pending.get(requestId);
        if (!entry)
            return false;
        this.pending.delete(requestId);
        entry.resolve({ reply, feedback });
        if (reply === "reject") {
            for (const [id, other] of [...this.pending]) {
                this.pending.delete(id);
                // 级联拒绝不复用原反馈：这些请求没被单独审过，理由必须如实说是连坐
                other.resolve({ reply: "reject", feedback: "用户已拒绝同会话的另一个请求，本次一并拒绝" });
            }
        }
        return true;
    }
    /** Rejects everything still pending — used on abort and process teardown so
     *  tool calls never hang forever (spec §5.4: restart semantics). Also clears
     *  the once-allowed cache so the next run asks again. */
    dispose(reason = "会话已中止或服务重启，请重试") {
        this.disposed = true;
        for (const [, entry] of [...this.pending]) {
            entry.resolve({ reply: "reject", feedback: reason });
        }
        this.pending.clear();
        this.onceAllowed.clear();
    }
}
//# sourceMappingURL=engine.js.map