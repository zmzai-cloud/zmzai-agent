import { McpStdioClient } from "./client.js";
import { createMcpHttpClient } from "./http-client.js";
const idSafe = (value) => value.replace(/[^A-Za-z0-9_-]/g, "_");
function sanitizeInputSchema(schema) {
    if (!schema || typeof schema !== "object")
        return { type: "object", properties: {}, additionalProperties: true };
    return schema;
}
function summarizeArgs(args) {
    try {
        const json = JSON.stringify(args);
        return json.length <= 2000 ? json : json.slice(0, 2000) + "…";
    }
    catch {
        return "";
    }
}
async function connectOne(entry, opts) {
    let client;
    if (entry.spec.type === "stdio") {
        const stdio = new McpStdioClient({ command: entry.spec.command, args: entry.spec.args, env: entry.spec.env, cwd: entry.spec.cwd }, { connectTimeoutMs: opts.connectTimeoutMs, allowedCommands: opts.allowedCommands });
        client = stdio;
    }
    else {
        const http = createMcpHttpClient(entry.spec, { requestTimeoutMs: opts.connectTimeoutMs });
        if (!http)
            return { kind: "error", message: `不支持的 transport：${entry.spec.type}` };
        client = http;
    }
    try {
        await startHandshake(entry.spec, client);
        const tools = await client.listTools();
        return { kind: "ok", client, tools };
    }
    catch (error) {
        client.close();
        return { kind: "error", message: error.message };
    }
}
/** 三种传输的握手统一化：stdio 客户端自带 start()；HTTP 两种在各自的实现里。 */
async function startHandshake(_spec, client) {
    const withStart = client;
    if (typeof withStart.start === "function")
        await withStart.start();
}
export async function startMcpServers(entries, opts = {}) {
    const clients = new Map();
    const defs = [];
    const settled = await Promise.allSettled(entries.map((entry) => connectOne(entry, opts)));
    const statuses = entries.map((entry, index) => {
        const outcome = settled[index];
        if (outcome.status === "fulfilled" && outcome.value.kind === "ok") {
            const { client, tools } = outcome.value;
            clients.set(entry.name, client);
            for (const tool of tools) {
                defs.push(mcpToolDef(entry, tool, client));
            }
            return { name: entry.name, state: "connected", transport: entry.spec.type, tools: tools.map((t) => t.name) };
        }
        const message = outcome.status === "rejected"
            ? String(outcome.reason?.message ?? outcome.reason)
            : outcome.value.kind === "error"
                ? outcome.value.message
                : "未知错误";
        return { name: entry.name, state: "error", transport: entry.spec.type, tools: [], error: message };
    });
    return {
        defs,
        statuses,
        dispose: () => {
            for (const client of clients.values())
                client.close();
            clients.clear();
        },
    };
}
function mcpToolDef(entry, tool, client) {
    const label = `${entry.name}/${tool.name}`;
    const id = `mcp__${idSafe(entry.name)}__${idSafe(tool.name)}`;
    return {
        id,
        label,
        description: tool.description ?? `MCP 工具 ${label}`,
        parametersJsonSchema: sanitizeInputSchema(tool.inputSchema),
        permission: (args) => ({
            permission: "mcp",
            patterns: [`${entry.name}/${tool.name}`],
            always: [`${entry.name}/*`],
            metadata: { server: entry.name, tool: tool.name, argsSummary: summarizeArgs(args) },
        }),
        executionMode: "sequential",
        async execute(args) {
            const result = await client.callTool(tool.name, args);
            if (result.isError)
                throw new Error(result.text || `MCP 工具 ${label} 返回 isError`);
            return {
                title: label,
                output: result.text || "（无文本输出）",
                metadata: { server: entry.name, tool: tool.name },
            };
        },
    };
}
//# sourceMappingURL=servers.js.map