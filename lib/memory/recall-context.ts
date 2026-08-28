import type { SessionInfo } from "@zmzai/agent-framework";

import { formatMemoryContext } from "./format";
import { getMemoryProvider, type MemoryProvider } from "./provider";

/** recall 编排（spec §记忆数据流）：按当前 prompt 查 bank（bankId =
 *  workspaceId 原值），把 facts 格式化成注入段。只做编排不做策略——
 *  超时/降级/兜底全部在 provider 内。任何失败都返回 undefined，零影响。 */
export async function recallMemoryContext(session: SessionInfo, text: string, provider: MemoryProvider = getMemoryProvider()): Promise<string | undefined> {
  if (!text.trim()) return undefined;
  try {
    const facts = await provider.recall({ bankId: session.workspaceId, query: text });
    return formatMemoryContext(facts ?? []);
  } catch {
    return undefined;
  }
}
