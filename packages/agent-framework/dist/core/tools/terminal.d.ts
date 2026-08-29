import type { ToolDef } from "./def.js";
/** 交互式终端（P0）：面向 Agent 的长驻/交互式进程能力——`npm run dev`、
 *  watch 模式、会问 y/n 的安装器等，一次性 bash 沙箱跑不了或会卡死。
 *
 *  分层：TerminalManager（环形缓冲 + 会话生命周期）只依赖 TerminalBackend
 *  接口；真正的 PTY vs 管道由宿主注入的 backend 决定（见
 *  adapters/terminal-backend.ts：动态 import node-pty，ABI 不匹配时降级
 *  管道模式）。工具层不需要知道区别。
 *
 *  安全位阶：start 直接在宿主机起进程（不进沙箱），独立权限分类
 *  `terminal` 走审批；read/write/kill 针对已批准创建的会话不再重复询问。 */
export type TerminalSessionStatus = "running" | "exited" | "killed";
export type TerminalSessionInfo = {
    id: string;
    name?: string;
    status: TerminalSessionStatus;
    backend: "pty" | "pipe";
    pid?: number;
    exitCode?: number | null;
    signal?: string | null;
    startedAt: string;
    bytesTotal: number;
};
/** 后端只关心这四件事。onData 之后必须保证 onExit 恰好触发一次。 */
export interface TerminalHandle {
    write(data: string): void;
    kill(signal?: string): void;
    resize?(cols: number, rows: number): void;
}
export interface TerminalBackend {
    readonly kind: "pty" | "pipe";
    start(input: {
        command: string;
        cwd: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
    }, hooks: {
        onData(chunk: string): void;
        onExit(result: {
            exitCode: number | null;
            signal: string | null;
        }): void;
    }): Promise<TerminalHandle & {
        pid?: number;
    }>;
}
export declare class TerminalManager {
    #private;
    constructor(backend: TerminalBackend, opts?: {
        ringCapBytes?: number;
        maxSessions?: number;
    });
    get backendKind(): "pty" | "pipe";
    start(input: {
        name?: string;
        command: string;
        cwd: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
    }): Promise<TerminalSessionInfo>;
    list(): TerminalSessionInfo[];
    getSession(id: string): TerminalSessionInfo | null;
    read(id: string, sinceBytes?: number): {
        output: string;
        cursor: number;
        totalDropped: number;
        truncatedHead: boolean;
        session: TerminalSessionInfo;
    } | null;
    write(id: string, text: string): boolean;
    resize(id: string, cols: number, rows: number): boolean;
    kill(id: string, signal?: string): boolean;
    disposeAll(signal?: string): void;
}
export declare function createTerminalTools(manager: TerminalManager, opts: {
    workspaceRoot: () => string;
}): ToolDef[];
//# sourceMappingURL=terminal.d.ts.map