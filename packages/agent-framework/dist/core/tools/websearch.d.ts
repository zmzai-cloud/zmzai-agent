import type { ToolDef } from "../tools/def.js";
/** websearch（P0 补齐）：联网搜索工具。后端策略按可用凭据自动选择：
 *  TAVILY_API_KEY / SERPER_API_KEY 配置时走对应 API，否则回退
 *  DuckDuckGo Lite HTML 抓取（零依赖、无 key）。fetchImpl/envLoader 可注入，
 *  便于测试与产品侧统一代理。 */
export type WebSearchResult = {
    title: string;
    url: string;
    snippet: string;
};
export type WebSearchOptions = {
    fetchImpl?: typeof fetch;
    /** 注入点：默认读 process.env。返回任意 provider key 时优先对应 API。 */
    envLoader?: () => Record<string, string | undefined>;
};
/** 解析 DuckDuckGo Lite 结果页。href 常为 /l/?uddg=<encoded> 重定向，需还原真实 URL。 */
export declare function parseDuckDuckGoHtml(html: string): WebSearchResult[];
export declare function createWebSearchTool(opts?: WebSearchOptions): ToolDef;
//# sourceMappingURL=websearch.d.ts.map