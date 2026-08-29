/** Agent Plugins 1.0 package reader. It intentionally implements only the
 *  portable package format: installation, trust, secrets, approval UX, and
 *  process execution remain the responsibility of the hosting product. */
export type PluginManifest = {
    $schema?: string;
    name: string;
    version?: string;
    description?: string;
    author?: string;
    homepage?: string;
    repository?: string;
    license?: string;
    keywords?: string[];
    extensions?: Record<string, unknown>;
};
export type PluginSkill = {
    id: string;
    path: string;
    markdown: string;
};
export type PluginMcpServer = {
    type: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
} | {
    type: "streamable-http";
    url: string;
    headers?: Record<string, string>;
} | {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
};
export type ParsedAgentPlugin = {
    root: string;
    manifest: PluginManifest;
    skills: PluginSkill[];
    mcpServers: Record<string, PluginMcpServer>;
    errors: string[];
};
export type PluginFileSystem = {
    read(path: string): Promise<string | null>;
    list(path: string): Promise<{
        path: string;
        isDirectory: boolean;
    }[]>;
};
export declare function parsePluginManifest(value: unknown): PluginManifest | null;
export declare function parsePluginMcp(root: string, value: unknown): {
    servers: Record<string, PluginMcpServer>;
    errors: string[];
};
export declare function parseAgentPlugin(input: {
    root: string;
    files: PluginFileSystem;
}): Promise<ParsedAgentPlugin>;
//# sourceMappingURL=plugin.d.ts.map