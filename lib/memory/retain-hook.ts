import type { LifecycleHook, RunTranscriptMessage } from "@zmzai/agent-framework";

import { takeMemoryAttempt } from "./attempt-run";
import { formatRetainTranscript } from "./format";
import { getMemoryProvider } from "./provider";

/** runId 级 in-flight 去重：同一次 run 的终态只 retain 一次（hook 理论上
 *  只触发一次，这里防宿主重复挂载/重放）。settle 后移除，允许同 runId
 *  的后续 run（重试场景）再次触发。 */
const inFlight = new Set<string>();

/** retain hook（spec §记忆数据流）：挂在 runner 终态，把本次 run 新增的
 *  user/assistant 消息 fire-and-forget 存入 bank。无 workspaceId / 空消息
 *  直接跳过；retain 抛错只 warn 不影响 run。 */
export function createMemoryRetainHook(): LifecycleHook {
  return {
    name: "memory-retain",
    onRunEnd: async (input: { sessionId: string; workspaceId?: string; newMessages?: RunTranscriptMessage[] }) => {
      // Capture and remove before any asynchronous work. A queued follow-up can
      // bind another Run to this session immediately after this hook starts.
      const runId = takeMemoryAttempt(input.sessionId);
      if (!input.workspaceId || !input.newMessages?.length) return;
      if (!runId) console.warn("[memory] missing Run binding for retention");
      const key = runId ?? input.sessionId;
      if (inFlight.has(key)) return;
      const content = formatRetainTranscript(input.newMessages);
      if (!content) return;
      inFlight.add(key);
      void getMemoryProvider()
        .retain({ bankId: input.workspaceId, content, context: JSON.stringify({ sessionId: input.sessionId, ...(runId ? { runId } : {}) }) })
        .catch((error) => console.warn(`[memory] retain failed for bank ${input.workspaceId}:`, error))
        .finally(() => inFlight.delete(key));
    },
  };
}

export function clearRetainInFlightForTest(): void {
  inFlight.clear();
}
