/** 循环防护（借鉴 Reasonix storm_breaker / repeat_failure_guard，见
 *  docs/borrowable-techniques.md §P0-2/§P0-3）：
 *
 *  - storm 断路器：同一工具连续以相同响应（签名 = 工具名 + 归一化错误，
 *    不含 args——卡住的模型会"化妆"参数重试，按 args 匹配会漏）失败 3 次，
 *    注入"改变策略"指令。不是终止，是 redirect。
 *  - blocked streak：连续 3 次权限拒绝同样注入指令（模型在硬闯不允许的操作）。
 *  - 重复失败守卫（edit 专用）：按语义签名 (path, oldText) 记失败，连续
 *    2 次同类失败后第 3 次重试先复查文件状态——内容已变则放行清记录，
 *    未变则拦截（避免无意义空转）。
 *
 *  只处理「工具执行了但死循环」，不碰模型级 error/retry 路径
 *  （F6 isRetryableError），两者互不干扰。 */
/** 连续同签名失败达到该次数 → 注入改变策略指令。 */
export declare const STORM_THRESHOLD = 3;
/** 连续权限拒绝达到该次数 → 注入改变策略指令。 */
export declare const BLOCKED_STREAK_THRESHOLD = 3;
/** edit 同语义签名失败达到该次数后，下一次重试触发状态复查。 */
export declare const REPEAT_EDIT_FAILURE_THRESHOLD = 2;
/** 归一化错误文本：抹掉数字（行号/字节数/耗时会让同因错误签名漂移），
 *  截断到 512 字符防签名爆炸。 */
export declare function normalizeError(text: string): string;
/** storm 签名：(工具名, 归一化错误)。不含 args（见文件头）。 */
export declare function stormSignature(toolName: string, errorText: string): string;
/** edit 重复失败的语义签名：(path, oldText)。 */
export declare function editFailureSignature(path: string, oldText: string): string;
export declare function strategyAdvisory(toolName: string, kind: "failure" | "blocked"): string;
export declare class LoopGuard {
    private stormSignature;
    private stormCount;
    private blockedStreak;
    private readonly editFailures;
    /** afterToolCall 调用：登记一次工具执行结果。命中 storm 阈值时返回
     *  注入文本（调用方覆写 result.content），否则返回 null。
     *  任何一次成功执行都清零 storm 与 blocked 计数。 */
    onToolResult(input: {
        toolName: string;
        isError: boolean;
        errorText: string;
    }): string | null;
    /** beforeToolCall 权限拒绝时调用。连续 BLOCKED_STREAK_THRESHOLD 次返回
     *  注入文本（拼进 block reason）。 */
    onBlocked(toolName: string): string | null;
    /** edit 失败后登记语义签名。 */
    noteEditFailure(path: string, oldText: string): void;
    /** edit 成功后清除对应签名（状态真的变了）。 */
    clearEditFailure(path: string, oldText: string): void;
    /** 该 (path, oldText) 是否已失败到需要状态复查的程度。 */
    needsEditRecheck(path: string, oldText: string): boolean;
}
//# sourceMappingURL=loop-guard.d.ts.map