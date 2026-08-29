import type { ModelProvider } from "./index.js";
/** 动态额外请求头（如登录态 cookie）。函数形式每次请求前求值，支持异步。 */
export type ProviderHeaders = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
/** 故障转移端点：主端点在首个流事件即报错时依次尝试（abort 不切）。 */
export type FailoverEndpoint = {
    baseUrl: string;
    apiKey?: string;
    /** 备用端点上的模型 id（缺省沿用主模型 id）。 */
    modelId?: string;
};
/** 降级事件（P0 可观测）：每次实际发生端点切换时回调一次。 */
export type FailoverEvent = {
    /** 被放弃的端点（undefined = 主端点）。 */
    from?: string;
    /** 切换到的端点。 */
    to: string;
    /** 触发降级的首事件错误文本。 */
    error: string;
    /** 第几次尝试（1 起）。 */
    attempt: number;
};
/** OpenAI-compatible ModelProvider (M5 CLI reference): drives the framework
 *  against any OpenAI-compatible chat-completions endpoint via env vars:
 *
 *   OPENAI_BASE_URL=https://api.openai.com/v1
 *   OPENAI_API_KEY=sk-...
 *   OPENAI_MODEL=gpt-4o            (default model)
 *
 *  The same provider serves relay-compatible backends (m.zmzai.cloud uses the
 *  OpenAI wire format), so the framework runs standalone with zero product
 *  coupling. headers 选项用于注入登录态 cookie 等动态鉴权头；baseUrl 支持
 *  函数形式（每次请求求值，宿主可在运行时切换端点，如设置页改 relay 地址）。
 *
 *  路由降级（N2a）：failoverEndpoints 配置备用 OpenAI 兼容端点。主端点在
 *  首个流事件即返回 error（reason=error，网络断/5xx/429/配置失效）时依次
 *  切换；首个事件已正常（连接 + 上游可用）则后续错误不再降级。 */
export declare function createOpenAiModelProvider(input?: {
    baseUrl?: string | (() => string);
    apiKey?: string;
    defaultModel?: string;
    headers?: ProviderHeaders;
    failoverEndpoints?: FailoverEndpoint[];
    /** 降级发生时回调（宿主用于日志/UI 提示）。 */
    onFailover?: (event: FailoverEvent) => void;
}): ModelProvider;
//# sourceMappingURL=openai-provider.d.ts.map