export type McpToolInfo = {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
};
export type McpCallResult = {
    /** Concatenated text content blocks; empty when the server returned none. */
    text: string;
    isError: boolean;
};
export type McpClientOptions = {
    /** Per-request timeout (default 30s). */
    requestTimeoutMs?: number;
    /** initialize 握手超时（default 15s）——含进程启动与首条响应。 */
    connectTimeoutMs?: number;
    /** 子进程工作目录（默认继承当前进程）。 */
    cwd?: string;
    /** 追加到子进程环境的基础变量（在 server env 之前合并，可被覆盖）。 */
    baseEnv?: Record<string, string>;
    /** stdio 命令白名单（P0 隔离）：配置后仅允许白名单内的可执行名启动。
     *  undefined/空数组 = 不限制。匹配对象是 spec.command 的 basename。 */
    allowedCommands?: string[];
};
/** 与 PluginMcpServer 的 stdio 形态解耦的最小入参，方便宿主直接构造。 */
export type StdioServerSpec = {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
};
export declare class McpStdioClient {
    #private;
    constructor(spec: StdioServerSpec, opts?: McpClientOptions);
    get connected(): boolean;
    /** 启动子进程并完成 initialize 握手。失败时保证子进程被回收后抛错。 */
    start(): Promise<void>;
    /** tools/list 自动翻页聚合全量工具。 */
    listTools(): Promise<McpToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
    request<T = unknown>(method: string, params?: unknown, timerOverride?: NodeJS.Timeout): Promise<T>;
    notify(method: string, params?: unknown): void;
    /** 注册服务器请求回调；返回 false 表示框架不提供该能力（客户端回 -32601）。 */
    onRequest(handler: ((method: string, params: unknown) => unknown | undefined | Promise<unknown | undefined>) | undefined): void;
    close(): void;
}
//# sourceMappingURL=client.d.ts.map