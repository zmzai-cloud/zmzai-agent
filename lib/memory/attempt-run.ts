/** The product Run for the current framework attempt. This is intentionally
 * process-local: after a restart there is no safe way to infer which queued
 * attempt a terminal hook belongs to from a session ID alone. */
const attempts = new Map<string, string>();

export function beginMemoryAttempt(sessionId: string, runId: string): void {
  attempts.set(sessionId, runId);
}

export function getMemoryAttempt(sessionId: string): string | null {
  return attempts.get(sessionId) ?? null;
}

export function takeMemoryAttempt(sessionId: string): string | null {
  const runId = getMemoryAttempt(sessionId);
  attempts.delete(sessionId);
  return runId;
}
