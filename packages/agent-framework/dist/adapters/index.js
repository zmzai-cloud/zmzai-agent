/** No-op sandbox: the framework still works for read/write/todo/subagent
 *  flows without any execution backend; bash tool errors out clearly. */
export function noopSandboxExecutor(reason = "未配置沙箱执行器") {
    return {
        async buildSnapshot() {
            return { revisionId: null, files: [] };
        },
        async run() {
            return { ok: false, outcome: "failed", exitCode: 1, outputText: "", durationMs: 0, artifacts: [], errorMessage: reason };
        },
    };
}
export const leaseDurationMs = 10 * 60 * 1000;
//# sourceMappingURL=index.js.map