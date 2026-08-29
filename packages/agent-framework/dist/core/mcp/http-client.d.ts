import type { PluginMcpServer } from "../agent/plugin.js";
import type { McpCallResult, McpToolInfo } from "./client.js";
/** MCP HTTP 双传输（P0 收尾）：
 *  - streamable-http（现行规范）：单端点 POST，响应可为 application/json 或
 *    text/event-stream 帧；initialize 下发的 Mcp-Session-Id 需回传；
 *    notifications POST 期望 202。
 *  - sse（遗留）：常开 GET 事件流承载响应；服务端以 endpoint 事件告知 POST 目标。
 *
 *  stdio 走既有 McpStdioClient；三者都满足下方 McpClientLike 结构。 */
export type McpClientLike = {
    listTools(): Promise<McpToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
    close(): void;
};
/** 增量 SSE 帧解析：data:/event:/id: 行、空行分帧、`:` 开头为注释心跳。 */
export declare function createSseParser(onEvent: (event: {
    event: string | null;
    data: string;
}) => void): (chunk: string) => void;
export declare class McpStreamableHttpClient implements McpClientLike {
    #private;
    constructor(url: string, opts?: {
        headers?: Record<string, string>;
        requestTimeoutMs?: number;
    });
    start(): Promise<void>;
    private postJsonRpc;
    request(method: string, params?: unknown): Promise<unknown>;
    notify(method: string, params?: unknown): Promise<void>;
    listTools(): Promise<McpToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
    close(): void;
}
export declare function toolsFromResult(result: unknown): McpToolInfo[];
export declare function callFromResult(result: unknown): McpCallResult;
export declare class McpSseClient implements McpClientLike {
    #private;
    constructor(url: string, opts?: {
        headers?: Record<string, string>;
        requestTimeoutMs?: number;
    });
    start(): Promise<void>;
    postToEndpoint(payload: Record<string, unknown>): Promise<Response>;
    private postedRequest;
    listTools(): Promise<McpToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
    notifyInitialized(): Promise<void>;
    close(): void;
    get closed(): boolean;
}
export declare function createMcpHttpClient(spec: PluginMcpServer, opts?: {
    requestTimeoutMs?: number;
}): McpClientLike | null;
//# sourceMappingURL=http-client.d.ts.map