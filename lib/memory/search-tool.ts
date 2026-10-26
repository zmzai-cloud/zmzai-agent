import { z } from "zod";
import type { ToolDef } from "@zmzai/agent-framework";

import { getMemoryAttempt } from "./attempt-run";
import { getMemoryProvider, isMemoryConfigured, type MemoryRecallHit } from "./provider";
import { readMemoryRunState } from "./run-state";

/** 主动检索独立于任务开头注入：注入是 800ms 的固定预算，工具允许稍宽。 */
const SEARCH_TIMEOUT_MS = 1_500;
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 20;
const OUTPUT_MAX_CHARS = 3_000;
const FACT_MAX_CHARS = 400;

/** 开头注入过的 memoryId——避免模型重复拿到同一批事实。 */
async function injectedMemoryIds(sessionId: string): Promise<Set<string>> {
  const runId = getMemoryAttempt(sessionId);
  if (!runId) return new Set();
  try {
    const state = await readMemoryRunState(runId);
    return new Set((state?.recall.hits ?? []).flatMap((hit) => (hit.memoryId ? [hit.memoryId] : [])));
  } catch {
    return new Set();
  }
}

function formatResults(query: string, hits: readonly MemoryRecallHit[], deduped: number): string {
  if (hits.length === 0) {
    return deduped > 0
      ? `没有新的记忆：命中的 ${deduped} 条已在本次任务的背景记忆中注入，直接使用即可。`
      : `没有找到与「${query}」相关的长期记忆。`;
  }
  const header = `[长期记忆检索: "${query}" — ${hits.length} 条]`;
  const lines: string[] = [header];
  let total = header.length;
  let used = 0;
  for (const hit of hits) {
    const text = hit.text.length > FACT_MAX_CHARS ? `${hit.text.slice(0, FACT_MAX_CHARS)}…` : hit.text;
    const score = hit.score !== undefined ? ` (${hit.score.toFixed(2)})` : "";
    const line = `- ${hit.memoryId ? `[${hit.memoryId}] ` : ""}${text}${score}`;
    if (total + 1 + line.length > OUTPUT_MAX_CHARS) break;
    lines.push(line);
    total += 1 + line.length;
    used += 1;
  }
  if (used < hits.length) lines.push(`…（另有 ${hits.length - used} 条未展开）`);
  lines.push("引用以上结论时标注 [memoryId]；与当前代码或用户最新说明冲突时以现状为准。");
  return lines.join("\n");
}

/**
 * memory_search：模型在任务中途主动检索本工作区的长期记忆。
 * 与开头注入共用同一 bank（workspaceId），但独立预算、只读、无需审批。
 */
export const memorySearchTool: ToolDef = {
  id: "memory_search",
  label: "检索长期记忆",
  description:
    "检索当前工作区此前沉淀的长期记忆（约定、决策、踩坑、常用命令）。以下情况应当先调用：" +
    "用户提到「上次/之前/以前/这个项目一直」或要求沿用既有做法；你要断言某个项目约定、架构决策或历史原因；" +
    "当前任务触及你尚不熟悉的模块。纯闲聊、单文件小改、问题已能从当前代码回答时不要调用。" +
    "返回条目带 memoryId，引用时标注；记忆可能过期，与当前代码或用户最新说明冲突时以现状为准。",
  parameters: z.object({
    query: z.string().min(1).max(400).describe("检索意图，用自然语言描述要找什么，不要只写关键词"),
    limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT).describe("最多返回条数"),
  }),
  permission: () => null,
  contract: { effect: [], retrySafety: "read_only", concurrency: { mode: "parallel_read" } },
  async execute(args, ctx) {
    if (!isMemoryConfigured()) {
      return { title: "检索长期记忆", output: "长期记忆未启用，无法检索。", metadata: { status: "disabled" } };
    }

    const hits = await getMemoryProvider().recall({
      bankId: ctx.workspaceId,
      query: args.query,
      maxFacts: args.limit,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    if (hits === null) {
      return {
        title: "检索长期记忆",
        output: "长期记忆服务暂不可用，本次检索没有结果；请基于当前代码与用户说明继续。",
        metadata: { status: "unavailable", bankId: ctx.workspaceId },
      };
    }

    const injected = await injectedMemoryIds(ctx.sessionId);
    const fresh = hits.filter((hit) => !hit.memoryId || !injected.has(hit.memoryId));
    const deduped = hits.length - fresh.length;
    const status = fresh.length > 0 ? "hit" : deduped > 0 ? "deduped" : "empty";

    return {
      title: fresh.length > 0 ? `检索到 ${fresh.length} 条长期记忆` : "长期记忆无新增结果",
      output: formatResults(args.query, fresh, deduped),
      metadata: { status, count: fresh.length, deduped, bankId: ctx.workspaceId },
    };
  },
};

/** 未配置记忆时不暴露工具（避免模型调用一个永远返回「未启用」的工具）。 */
export function resolveMemoryTools(): ToolDef[] {
  return isMemoryConfigured() ? [memorySearchTool] : [];
}
