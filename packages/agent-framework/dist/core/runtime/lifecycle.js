/** 生命周期钩子（P0）：宿主/插件在不侵入 runner 的前提下观察并约束运行。
 *  参考 codex hooks/ 与 gemini hooks/ 的最小面——四个挂点：
 *
 *  - onRunStart      一次 run 开始（收到 prompt，尚未调模型）
 *  - onBeforeToolCall  权限审批通过后、工具执行前；可 {block:true,reason}
 *                      拦截（reason 会作为结果反馈给模型）
 *  - onAfterToolCall   工具执行结束（含 isError）；只读，不可改结果
 *  - onRunEnd        run 终态（ok/aborted）
 *
 *  约定：钩子抛错只告警不中断运行；block 是唯一有副作用的出口。多个 hook
 *  依次调用，第一个返回 block 的生效。 */
function warn(hook, phase, error) {
    console.warn(`[zmzai-agent-framework] lifecycle hook ${hook.name ?? "anonymous"}#${phase} 抛错已忽略：`, error);
}
export function fireRunStart(hooks, input) {
    return hooks.map((hook) => {
        if (!hook.onRunStart)
            return Promise.resolve();
        try {
            return Promise.resolve(hook.onRunStart(input)).catch((error) => warn(hook, "onRunStart", error));
        }
        catch (error) {
            warn(hook, "onRunStart", error);
            return Promise.resolve();
        }
    });
}
/** 返回第一个生效的 block；钩子抛错视同放行。 */
export async function firstToolBlock(hooks, input) {
    for (const hook of hooks) {
        if (!hook.onBeforeToolCall)
            continue;
        try {
            const result = await hook.onBeforeToolCall(input);
            if (result && "block" in result && result.block === true) {
                return { block: true, reason: result.reason };
            }
        }
        catch (error) {
            warn(hook, "onBeforeToolCall", error);
        }
    }
    return undefined;
}
export function fireAfterToolCall(hooks, input) {
    return hooks.map((hook) => {
        if (!hook.onAfterToolCall)
            return Promise.resolve();
        try {
            return Promise.resolve(hook.onAfterToolCall(input)).catch((error) => warn(hook, "onAfterToolCall", error));
        }
        catch (error) {
            warn(hook, "onAfterToolCall", error);
            return Promise.resolve();
        }
    });
}
export function fireRunEnd(hooks, input) {
    return hooks.map((hook) => {
        if (!hook.onRunEnd)
            return Promise.resolve();
        try {
            return Promise.resolve(hook.onRunEnd(input)).catch((error) => warn(hook, "onRunEnd", error));
        }
        catch (error) {
            warn(hook, "onRunEnd", error);
            return Promise.resolve();
        }
    });
}
//# sourceMappingURL=lifecycle.js.map