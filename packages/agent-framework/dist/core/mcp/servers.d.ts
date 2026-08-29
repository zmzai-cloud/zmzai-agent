import type { ExternalToolDef } from "../tools/def.js";
import type { PluginMcpServer } from "../agent/plugin.js";
/** 把已解析的插件 mcp.json server 配置接成可用的 MCP 工具集：逐个启动
 *  （stdio 子进程），listTools 后生成命名空间化的 ExternalToolDef。
 *  单个 server 连不上不影响其它——错误进 statuses，由宿主决定透出方式。 */
export type McpServerStatus = {
    name: string;
    state: "connected" | "error";
    transport: string;
    tools: string[];
    error?: string;
};
export type McpServerEntry = {
    name: string;
    spec: PluginMcpServer;
};
export type McpPoolResult = {
    /** 成功连接的 server 提供的工具（id 形如 mcp__<server>__<tool>）。 */
    defs: ExternalToolDef[];
    statuses: McpServerStatus[];
    /** 统一关停（宿主退出时调用）。 */
    dispose: () => void;
};
export type McpPoolOptions = {
    connectTimeoutMs?: number;
    /** stdio 命令白名单（P0 隔离）：透传给 McpStdioClient，basename 匹配。 */
    allowedCommands?: string[];
};
export declare function startMcpServers(entries: McpServerEntry[], opts?: McpPoolOptions): Promise<McpPoolResult>;
//# sourceMappingURL=servers.d.ts.map