/**
 * 长期记忆注入/沉淀的纯文本格式化（spec §3）。
 *
 * 预算与静态注入（16k 知识 / 24k 单 skill / 80k skills 总量）互不挤占：
 * recall 结果硬上限 4k 字符，retain 输入硬上限 8k 字符。
 */

/** recall 结果硬上限（字符）。 */
export const MEMORY_CONTEXT_MAX_CHARS = 4_000;
/** retain 输入硬上限（字符）。 */
export const RETAIN_TRANSCRIPT_MAX_CHARS = 8_000;

export const MEMORY_CONTEXT_HEADER =
  "[Long-term memory — recall from past work on this workspace; treat as background, verify before acting]";

/**
 * 将 recall 命中的事实列表格式化为注入上下文。无有效事实返回 undefined。
 * 总长超出 4k 时截断：放得下的整行保留，放不下的最后一条就地截断（不产生残行），其后丢弃。
 */
export function formatMemoryContext(facts: readonly string[]): string | undefined {
  const items = facts.map((fact) => fact.trim()).filter((fact) => fact.length > 0);
  if (!items.length) return undefined;

  const lines: string[] = [MEMORY_CONTEXT_HEADER];
  let total = MEMORY_CONTEXT_HEADER.length;
  for (const fact of items) {
    const line = `- ${fact}`;
    if (total + 1 + line.length <= MEMORY_CONTEXT_MAX_CHARS) {
      lines.push(line);
      total += 1 + line.length;
      continue;
    }
    const remaining = MEMORY_CONTEXT_MAX_CHARS - total - 1;
    if (remaining > 0) {
      lines.push(line.slice(0, remaining));
    }
    break;
  }
  return lines.join("\n");
}

export type RetainTranscriptMessage = { role: "user" | "assistant"; text: string };

/**
 * 将一次 run 的新增消息拼成 retain 输入。超出 8k 时整体截断
 * （截断的是往 hindsight 投喂的抽取原料，无需保行完整）。
 */
export function formatRetainTranscript(messages: readonly RetainTranscriptMessage[]): string | undefined {
  const parts = messages
    .map((message) => {
      const text = message.text.trim();
      return text ? `${message.role}: ${text}` : null;
    })
    .filter((part): part is string => Boolean(part));
  if (!parts.length) return undefined;
  const joined = parts.join("\n");
  return joined.length > RETAIN_TRANSCRIPT_MAX_CHARS ? joined.slice(0, RETAIN_TRANSCRIPT_MAX_CHARS) : joined;
}
