import type { LifecycleHook, RunTranscriptMessage } from "@zmzai/agent-framework";

import { RunModel } from "@/models/run";

import { formatRetainTranscript } from "./format";
import { getMemoryProvider } from "./provider";

/** runId 级 in-flight 去重：同一次 run 的终态只 retain 一次（hook 理论上
 *  只触发一次，这里防宿主重复挂载/重放）。settle 后移除，允许同 runId
 *  的后续 run（重试场景）再次触发。 */
const inFlight = new Set<string>();

async function runIdForSession(sessionId: string): Promise<string> {
  try {
    // 不带 active 过滤：终态时 run 可能已标记完成。查询失败回退 sessionId。
    const run = await RunModel.findOne({ sessionId }).sort({ createdAt: -1 }).select({ runId: 1 }).lean();
    if (run?.runId) return run.runId;
  } catch {
    // 回退到 sessionId
  }
  return sessionId;
}

/** retain hook（spec §记忆数据流）：挂在 runner 终态，把本次 run 新增的
 *  user/assistant 消息 fire-and-forget 存入 bank。无 workspaceId / 空消息
 *  直接跳过；retain 抛错只 warn 不影响 run。 */
export function createMemoryRetainHook(): LifecycleHook {
  return {
    name: "memory-retain",
    onRunEnd: async (input: { sessionId: string; workspaceId?: string; newMessages?: RunTranscriptMessage[] }) => {
      if (!input.workspaceId || !input.newMessages?.length) return;
      const runId = await runIdForSession(input.sessionId);
      if (inFlight.has(runId)) return;
      const content = formatRetainTranscript(input.newMessages);
      if (!content) return;
      inFlight.add(runId);
      void getMemoryProvider()
        .retain({ bankId: input.workspaceId, content, context: JSON.stringify({ sessionId: input.sessionId, runId }) })
        .catch((error) => console.warn(`[memory] retain failed for bank ${input.workspaceId}:`, error))
        .finally(() => inFlight.delete(runId));
    },
  };
}

export function clearRetainInFlightForTest(): void {
  inFlight.clear();
}
