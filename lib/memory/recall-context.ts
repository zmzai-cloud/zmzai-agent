import type { SessionInfo } from "@zmzai/agent-framework";

import { formatMemoryContextWithFacts } from "./format";
import { getMemoryProvider, isMemoryConfigured, type MemoryProvider, type MemoryRecallHit } from "./provider";

export type MemoryRecallReceipt = {
  bankId: string;
  status: "hit" | "empty" | "unavailable" | "disabled";
  hits: Array<{ memoryId?: string; text: string }>;
};

function boundedPreviews(hits: readonly MemoryRecallHit[], usedFacts: readonly string[]): MemoryRecallReceipt["hits"] {
  return usedFacts.slice(0, 8).map((text, index) => ({
    ...(hits[index]?.memoryId ? { memoryId: hits[index].memoryId } : {}),
    text: Array.from(text).slice(0, 240).join(""),
  }));
}

/** recall 编排（spec §记忆数据流）：按当前 prompt 查 bank（bankId =
 *  workspaceId 原值），把 facts 格式化成注入段。只做编排不做策略——
 *  超时/降级/兜底全部在 provider 内。任何失败都返回 undefined，零影响。 */
export async function recallMemoryContext(
  session: SessionInfo,
  text: string,
  provider: MemoryProvider = getMemoryProvider(),
  onReceipt?: (receipt: MemoryRecallReceipt) => void | Promise<void>,
): Promise<string | undefined> {
  if (!text.trim()) return undefined;
  let receipt: MemoryRecallReceipt;
  let context: string | undefined;
  try {
    if (!isMemoryConfigured()) {
      receipt = { bankId: session.workspaceId, status: "disabled", hits: [] };
    } else {
      const facts = await provider.recall({ bankId: session.workspaceId, query: text });
      if (facts === null) {
        receipt = { bankId: session.workspaceId, status: "unavailable", hits: [] };
      } else {
        const usableFacts = facts.filter((fact) => fact.text.trim().length > 0);
        const formatted = formatMemoryContextWithFacts(usableFacts.map((fact) => fact.text));
        context = formatted.context;
        receipt = {
          bankId: session.workspaceId,
          status: formatted.usedFacts.length ? "hit" : "empty",
          hits: boundedPreviews(usableFacts, formatted.usedFacts),
        };
      }
    }
  } catch {
    receipt = { bankId: session.workspaceId, status: "unavailable", hits: [] };
  }
  try { await onReceipt?.(receipt); } catch { /* Receipt persistence cannot block model context. */ }
  return context;
}
