import type { LifecycleHook, RunTranscriptMessage } from "@zmzai/agent-framework";

import { takeMemoryAttempt } from "./attempt-run";
import { formatRetainTranscript } from "./format";
import { getMemoryProvider, isMemoryConfigured } from "./provider";
import { recordRetentionTransition, type RetentionEventType } from "./events";
import { compareAndSetRetention } from "./run-state";
import { RunModel } from "@/models/run";

/** Duplicate terminal callbacks must not retry an already settled Run. */
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
      if (!input.workspaceId) return;
      const key = runId ?? input.sessionId;
      if (inFlight.has(key)) return;
      const content = formatRetainTranscript(input.newMessages ?? []);
      inFlight.add(key);
      const publish = (type: RetentionEventType, from: "not_started" | "pending") => runId
        ? recordRetentionTransition({ runId, sessionId: input.sessionId, bankId: input.workspaceId!, type, from })
        : Promise.resolve(true);
      void (async () => {
        if (!runId) {
          console.warn(`[memory] missing Run binding for session ${input.sessionId}`);
          // Framework-only sessions keep best-effort retention. If a product
          // Run exists, guessing its identity could write an orphaned fact.
          if (await RunModel.exists({ sessionId: input.sessionId })) return;
        }
        if (!content) return publish("memory.retention_skipped", "not_started");
        if (!isMemoryConfigured()) return publish("memory.retention_disabled", "not_started");
        if (!(await publish("memory.retention_pending", "not_started"))) return;
        if (runId) {
          // The pending append can be delayed beyond the stale threshold.
          // Refresh its CAS lease before sending a five-second request.
          const stillPending = await compareAndSetRetention({
            runId, sessionId: input.sessionId, bankId: input.workspaceId!,
            from: "pending", to: "pending", at: new Date(),
          });
          if (!stillPending) return;
        }
        const status = await getMemoryProvider().retainWithOutcome({
          bankId: input.workspaceId!, content,
          context: JSON.stringify({ sessionId: input.sessionId, ...(runId ? { runId } : {}) }),
        });
        await publish(`memory.retention_${status}`, "pending");
      })().catch(() => {
        // SDK and persistence errors may include transcript text.
        console.warn(`[memory] retention processing failed for bank ${input.workspaceId}`);
      }).finally(() => inFlight.delete(key));
    },
  };
}

export function clearRetainInFlightForTest(): void {
  inFlight.clear();
}
