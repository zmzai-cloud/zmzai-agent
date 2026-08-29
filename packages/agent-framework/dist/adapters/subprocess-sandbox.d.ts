import type { SandboxExecutor } from "../adapters/index.js";
export declare function createSubprocessSandbox(input?: {
    /** 提供后：快照从真实工作区采集、新产物回写工作区（函数形式随项目切换）。 */
    workspaceRoot?: string | (() => string | null | undefined);
}): SandboxExecutor;
//# sourceMappingURL=subprocess-sandbox.d.ts.map