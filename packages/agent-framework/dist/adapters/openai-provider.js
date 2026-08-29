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
export function createOpenAiModelProvider(input) {
    // baseUrl 动态求值：函数形式每次请求重新解析（设置页改 relay 端点即时生效）
    const baseUrlInput = input?.baseUrl;
    const resolveBase = () => ((typeof baseUrlInput === "function" ? baseUrlInput() : baseUrlInput) ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const apiKey = input?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    const defaultModel = input?.defaultModel ?? process.env.OPENAI_MODEL ?? "gpt-4o";
    const failovers = input?.failoverEndpoints ?? [];
    const onFailover = input?.onFailover;
    const resolveHeaders = async () => {
        const h = input?.headers;
        if (!h)
            return {};
        return typeof h === "function" ? await h() : h;
    };
    return {
        getModel(ref) {
            return {
                id: ref.modelId || defaultModel,
                name: ref.modelId || defaultModel,
                api: "openai-completions",
                provider: "zmzai-openai",
                baseUrl: resolveBase(),
                reasoning: false,
                input: ["text", "image"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128_000,
                maxTokens: 16_384,
                // 兼容开关收紧到经典 OpenAI 字段：部分上游（含 relay 的通道）对
                // strict / stream_options 等新字段会 400，这里显式禁用。
                // supportsReasoningEffort：relay 已按模型白名单接受 reasoning_effort
                // （不支持的模型 relay 返回 400 REASONING_EFFORT_NOT_ALLOWED，UI 层
                // 只在模型允许的档位上展示选择器）。
                compat: {
                    supportsStrictMode: false,
                    maxTokensField: "max_tokens",
                    supportsUsageInStreaming: false,
                    supportsReasoningEffort: true,
                    supportsFinishReason: true,
                },
            };
        },
        streamFor(session) {
            void session;
            // streamFn built per call; auth cookie injected by the custom fetch below.
            return (async (model, context, options) => {
                const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-completions");
                const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
                const dynamicHeaders = await resolveHeaders();
                // 每次调 streamFn 重新求值 headers（登录态/个人 key 可动态变化）
                const attempt = async (ep) => {
                    const target = ep
                        ? { ...model, baseUrl: ep.baseUrl.replace(/\/$/, ""), ...(ep.modelId ? { id: ep.modelId, name: ep.modelId } : {}) }
                        // 主端点同样每请求重算 baseUrl（summaryModel 等缓存的 model 对象也生效）
                        : { ...model, baseUrl: resolveBase() };
                    return streamSimple(target, context, {
                        ...(options ?? {}),
                        // 占位 key：pi-ai 要求非空 apiKey（否则 throw）。relay 不校验
                        // Bearer，真实鉴权靠下方自定义 fetch 注入的登录 cookie。
                        apiKey: ep?.apiKey ?? apiKey ?? "cookie-auth",
                        maxTokens: options?.maxTokens ?? 16_384,
                        // 自定义 fetch：剥掉 SDK 自动生成的 Authorization（relay 对无效
                        // Bearer 直接 401，不会回退到 cookie 登录态），再注入动态头。
                        fetch: async (url, init) => {
                            const headers = new Headers(init?.headers);
                            headers.delete("authorization");
                            for (const [name, value] of Object.entries(dynamicHeaders))
                                headers.set(name, value);
                            return fetch(url, { ...(init ?? {}), headers });
                        },
                    });
                };
                // 无备用端点：直连主端点（零额外开销）
                if (failovers.length === 0)
                    return attempt();
                // 有备用端点：peek 首事件判定健康度，error(reason=error) 时降级重试
                const endpoints = [undefined, ...failovers];
                let lastStream = null;
                let lastFirst = null;
                let lastIterator = null;
                for (let i = 0; i < endpoints.length; i++) {
                    let stream;
                    try {
                        stream = await attempt(endpoints[i]);
                    }
                    catch (error) {
                        if (i + 1 < endpoints.length)
                            continue;
                        throw error;
                    }
                    const iterator = stream[Symbol.asyncIterator]();
                    const first = await iterator.next();
                    const event = first.value;
                    const retryable = !first.done && event?.type === "error" && event.reason === "error";
                    if (retryable && i + 1 < endpoints.length) {
                        // error 事件的 payload 是 AssistantMessage（含 errorMessage）
                        const errPayload = event.error;
                        const detail = errPayload?.errorMessage ?? JSON.stringify(errPayload ?? {}) ?? "上游不可用";
                        try {
                            onFailover?.({
                                from: endpoints[i] ? endpoints[i].baseUrl : undefined,
                                to: endpoints[i + 1].baseUrl,
                                error: String(detail).slice(0, 300),
                                attempt: i + 1,
                            });
                        }
                        catch {
                            // 观测回调永不影响主链路
                        }
                        continue;
                    }
                    lastStream = stream;
                    lastFirst = first;
                    lastIterator = iterator;
                    break;
                }
                if (!lastStream || !lastIterator) {
                    // 理论不可达（endpoints 至少一项）；防御性抛错
                    throw new Error("模型请求失败：所有端点均不可用");
                }
                // 健康流桥接：peek 到的事件重放进 wrapper，后台继续透传剩余事件
                const wrapper = createAssistantMessageEventStream();
                void (async () => {
                    try {
                        if (!lastFirst.done && lastFirst.value)
                            wrapper.push(lastFirst.value);
                        while (true) {
                            const next = await lastIterator.next();
                            if (next.done) {
                                wrapper.end();
                                return;
                            }
                            wrapper.push(next.value);
                        }
                    }
                    catch {
                        wrapper.end();
                    }
                })();
                return wrapper;
            });
        },
    };
}
//# sourceMappingURL=openai-provider.js.map