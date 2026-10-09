import type { SessionInfo } from "@zmzai/agent-framework";

import { ensureRunForFrameworkAttempt } from "@/lib/task-run-control";

import { beginMemoryAttempt, getMemoryAttempt } from "./attempt-run";
import { recordMemoryEvent } from "./events";
import { recallMemoryContext, type MemoryRecallReceipt } from "./recall-context";

function recordRecallReceipt(session: SessionInfo, receipt: MemoryRecallReceipt): void {
  const runId = getMemoryAttempt(session.id);
  if (!runId) return;
  const type = receipt.status === "disabled" ? "memory.recall_disabled"
    : receipt.status === "unavailable" ? "memory.recall_unavailable"
    : "memory.recall_succeeded";
  // Persistence runs independently of model context delivery.
  void recordMemoryEvent({
    runId,
    sessionId: session.id,
    bankId: receipt.bankId,
    type,
    payload: type === "memory.recall_succeeded" ? { hits: receipt.hits, usedHitCount: receipt.usedHitCount ?? receipt.hits.length } : {},
  }).catch(() => {
    // Receipt persistence is best effort; the model still gets recalled context.
  });
}

/** Called by the runner for every real attempt, including dequeued prompts. */
export async function memoryContextForAttempt(session: SessionInfo, text: string, productRuns: boolean): Promise<string | undefined> {
  if (productRuns) {
    try {
      const run = await ensureRunForFrameworkAttempt(session);
      if (run) beginMemoryAttempt(session.id, run.runId);
    } catch {
      // Memory remains best-effort if the product Run cannot be resolved.
    }
  }
  return recallMemoryContext(session, text, undefined, (receipt) => recordRecallReceipt(session, receipt));
}
