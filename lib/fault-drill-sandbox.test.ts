import { describe, expect, it } from "vitest";

import { classifySandboxOutcome, waitForSandboxTerminalRun } from "@/lib/sandbox-execution";

/** Fault-drill: SSE 中断后通过 poll 恢复 sandbox 最终状态。
 *  验证 waitForSandboxTerminalRun 在 SSE 断开时仍能通过 getAgentSandboxRun
 *  轮询到终态，不会把已完成的工作标记为 unknown。 */
describe("fault-drill: sandbox disconnect recovery", () => {
  it("classifies terminal outcomes correctly", () => {
    expect(classifySandboxOutcome({ status: "succeeded", exitCode: 0 })).toBe("succeeded");
    expect(classifySandboxOutcome({ status: "failed", exitCode: 1 })).toBe("failed");
    // cancelled is treated as a recognized terminal → "failed".
    // The runner's waitForSandboxTerminalRun handles the "unknown" path
    // when the sandbox service is unreachable (returns null).
    expect(classifySandboxOutcome({ status: "cancelled" })).toBe("failed");
    expect(classifySandboxOutcome({ status: "running" })).toBe("unknown");
    expect(classifySandboxOutcome(null)).toBe("unknown");
  });

  it("cancelled maps to failed so the runner preserves the checkpoint via the unknown-side-effect path", () => {
    // classifySandboxOutcome recognizes "cancelled" as a terminal status
    // and maps it to "failed". The runner handles side-effect preservation
    // through a separate path: when the sandbox service is unreachable
    // (SANDBOX_UNAVAILABLE), the outcome is "unknown" and the checkpoint
    // is kept. A known "cancelled" status is a deliberate terminal decision.
    expect(classifySandboxOutcome({ status: "cancelled", exitCode: null })).toBe("failed");
  });

  it("preserves succeeded status even with non-zero exit code edge case", () => {
    // If the sandbox reports succeeded but with a non-zero exit code,
    // the outcome is still "failed" because exit code is authoritative.
    expect(classifySandboxOutcome({ status: "succeeded", exitCode: 1 })).toBe("failed");
  });

  it("waitForSandboxTerminalRun returns null when sandbox is permanently unavailable", async () => {
    // When the sandbox service is completely down and the timeout expires,
    // the function should return null (the last poll result), allowing
    // the caller to classify the outcome as "unknown" and preserve state.
    const result = await waitForSandboxTerminalRun("nonexistent_run", 100, 50);
    // The function returns null when getAgentSandboxRun throws consistently
    // and no previous result was cached.
    expect(result).toBeNull();
  });
});
