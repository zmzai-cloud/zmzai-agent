import type { TerminalBackend } from "../core/tools/terminal.js";
/** 宿主终端后端单例：优先真 PTY，node-pty 不可用或 spawn 探测失败时降级管道模式。
 *  首次调用即锁定后端种类（同步），session 标签从此不存在竞态。 */
export declare function createHostTerminalBackend(): TerminalBackend;
//# sourceMappingURL=terminal-backend.d.ts.map