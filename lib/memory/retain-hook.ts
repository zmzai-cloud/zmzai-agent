import type { LifecycleHook, RunTranscriptMessage } from "@zmzai/agent-framework";

import { takeMemoryAttempt } from "./attempt-run";
import { formatRetainTranscript } from "./format";
import { getMemoryProvider, isMemoryConfigured } from "./provider";
import { recordMemoryEvent, type MemoryEventType } from "./events";

/** Duplicate terminal callbacks must not retry an already settled Run. */
const inFlight = new Set<string>();
const completed = new Set<string>();

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
      if (!input.workspaceId) return;
      if (!runId) console.warn("[memory] missing Run binding for retention");
      const key = runId ?? input.sessionId;
      if (inFlight.has(key) || (runId && completed.has(runId))) return;
      const content = formatRetainTranscript(input.newMessages ?? []);
      inFlight.add(key);
      const publish = (type: MemoryEventType) => runId
        ? recordMemoryEvent({ runId, sessionId: input.sessionId, bankId: input.workspaceId!, type, payload: {} })
        : Promise.resolve();
      void (async () => {
        if (!content) return publish("memory.retention_skipped");
        if (!isMemoryConfigured()) return publish("memory.retention_disabled");
        await publish("memory.retention_pending");
        const status = await getMemoryProvider().retainWithOutcome({
          bankId: input.workspaceId!, content,
          context: JSON.stringify({ sessionId: input.sessionId, ...(runId ? { runId } : {}) }),
        });
        await publish(`memory.retention_${status}`);
      })().catch(() => {
        // SDK and persistence errors may include transcript text.
        console.warn(`[memory] retention processing failed for bank ${input.workspaceId}`);
      }).finally(() => {
        inFlight.delete(key);
        if (runId) {
          completed.add(runId);
          if (completed.size > 1_000) completed.delete(completed.values().next().value!);
        }
      });
    },
  };
}

export function clearRetainInFlightForTest(): void {
  inFlight.clear();
  completed.clear();
}
