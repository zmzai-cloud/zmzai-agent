import type { SessionInfo } from "@zmzai/agent-framework";

import { ensureRunForFrameworkAttempt } from "@/lib/task-run-control";

import { beginMemoryAttempt } from "./attempt-run";
import { recallMemoryContext } from "./recall-context";

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
  return recallMemoryContext(session, text);
}
