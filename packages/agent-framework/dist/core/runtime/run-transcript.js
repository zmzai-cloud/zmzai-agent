/** F6 自动重试时注入的合成 user 占位文本。run-transcript 提取时排除它，
 *  避免合成占位内容被当成真实用户发言存入长期记忆。 */
export const RETRY_PLACEHOLDER_TEXT = "（上轮回复生成中断，请继续完成回复。）";
function textOf(message) {
    if (message.role !== "user" && message.role !== "assistant")
        return "";
    const content = message.content;
    if (typeof content === "string")
        return content.trim();
    if (!Array.isArray(content))
        return "";
    return content
        .filter((block) => typeof block === "object" && block !== null && block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
}
/** 提取一次 run 新增的可记忆内容：从 baselineCount 起切片，只保留
 *  user/assistant 的非空文本（thinking/toolCall/toolResult 一律跳过），
 *  排除 F6 合成占位。返回结果供宿主 hook retain 到长期记忆。 */
export function extractRunTranscript(messages, baselineCount) {
    const out = [];
    for (const message of messages.slice(Math.max(0, baselineCount))) {
        if (message.role !== "user" && message.role !== "assistant")
            continue;
        const text = textOf(message);
        if (!text)
            continue;
        if (message.role === "user" && text === RETRY_PLACEHOLDER_TEXT)
            continue;
        out.push({ role: message.role, text });
    }
    return out;
}
//# sourceMappingURL=run-transcript.js.map