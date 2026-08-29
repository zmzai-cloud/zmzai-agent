/** 失败日志按行剪裁（tutorial-advanced 01-trim retrofit）：
 *
 *  head+tail 对成功输出够用，但失败日志有更狠的裁法——构建/测试日志的
 *  价值高度集中：几千行 pass 噪音里只有错误声明、断言详情和调用栈值钱。
 *
 *  策略分流（trimToolOutput）：
 *  - failed=true → 只保留命中错误特征的行 + 前后 N 行上下文，区间合并，
 *    区间之间插省略标记；错误行太多撑爆上限时最后一道闸仍是 head+tail。
 *  - failed=false → head+tail（复用 adapter 的 pruneOutput，字节预算）。
 *
 *  两个上限不一样的理由：失败剪裁后信息密度极高（全是错误），8000 字符
 *  ≈ 2000 tokens 足够模型定位问题；成功输出往往是结构化数据，多给配额。
 */
export type FailureTrimResult = {
    text: string;
    trimmed: boolean;
    keptLines: number;
    totalLines: number;
    omittedBytes: number;
};
/**
 * 失败日志剪裁：只留错误行 + 上下文。
 * 没找到任何错误行时降级为 head+tail 字符裁剪。
 */
export declare function pruneFailureLog(text: string, opts: {
    contextLines?: number;
    maxChars: number;
}): FailureTrimResult;
/** 工具失败输出裁剪入口：超预算才裁（小失败输出保持原样），失败但没超预算不动。 */
export declare function trimFailureOutput(text: string): FailureTrimResult;
//# sourceMappingURL=trim.d.ts.map