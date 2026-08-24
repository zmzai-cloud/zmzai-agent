import { describe, expect, it } from "vitest";

import {
  canStartContinuationRun,
  canSupersedeActiveRun,
  canTransitionRun,
  isActiveRunStatus,
  isTerminalRunStatus,
  taskStatusForRun,
  transitionRun,
  InvalidRunTransitionError,
} from "@/lib/task-state-machine";

/** Fault-drill: 服务重启后 Run 状态从 checkpoint 恢复。
 *  验证状态机在服务重启场景下的行为：
 *  - 终态 Run 不能被覆盖
 *  - 活跃状态的 Run 可以被取消
 *  - continuation Run 只能在合法的前置状态上启动
 *  - 状态投影（Run → Task）不会把失败映射成成功 */
describe("fault-drill: service restart state recovery", () => {
  it("prevents illegal transitions from terminal states", () => {
    for (const terminal of ["succeeded", "failed", "cancelled"] as const) {
      expect(isActiveRunStatus(terminal)).toBe(false);
      expect(isTerminalRunStatus(terminal)).toBe(true);
      for (const target of ["created", "running", "waiting_input", "waiting_approval", "paused", "succeeded", "failed", "cancelled"] as const) {
        expect(canTransitionRun(terminal, target)).toBe(false);
      }
    }
  });

  it("transitionRun throws on illegal transitions instead of silently corrupting state", () => {
    expect(() => transitionRun("succeeded", "running")).toThrow(InvalidRunTransitionError);
    expect(() => transitionRun("failed", "succeeded")).toThrow(InvalidRunTransitionError);
    expect(() => transitionRun("cancelled", "running")).toThrow(InvalidRunTransitionError);
  });

  it("allows valid transitions from running state", () => {
    expect(canTransitionRun("running", "succeeded")).toBe(true);
    expect(canTransitionRun("running", "failed")).toBe(true);
    expect(canTransitionRun("running", "cancelled")).toBe(true);
    expect(canTransitionRun("running", "waiting_input")).toBe(true);
    expect(canTransitionRun("running", "waiting_approval")).toBe(true);
    expect(canTransitionRun("running", "paused")).toBe(true);
  });

  it("continuation Run can only start from appropriate states", () => {
    // resume requires paused or waiting_input
    expect(canStartContinuationRun("resume", "paused")).toBe(true);
    expect(canStartContinuationRun("resume", "waiting_input")).toBe(true);
    expect(canStartContinuationRun("resume", "running")).toBe(false);
    expect(canStartContinuationRun("resume", "succeeded")).toBe(false);

    // retry and follow_up require terminal state
    expect(canStartContinuationRun("retry", "failed")).toBe(true);
    expect(canStartContinuationRun("retry", "succeeded")).toBe(true);
    expect(canStartContinuationRun("retry", "cancelled")).toBe(true);
    expect(canStartContinuationRun("retry", "running")).toBe(false);

    expect(canStartContinuationRun("follow_up", "succeeded")).toBe(true);
    expect(canStartContinuationRun("follow_up", "failed")).toBe(true);
    expect(canStartContinuationRun("follow_up", "running")).toBe(false);
  });

  it("task status projection never maps failure to success", () => {
    expect(taskStatusForRun("succeeded")).toBe("succeeded");
    expect(taskStatusForRun("failed")).toBe("failed");
    expect(taskStatusForRun("cancelled")).toBe("cancelled");
    expect(taskStatusForRun("running")).toBe("active");
    expect(taskStatusForRun("created")).toBe("active");
    expect(taskStatusForRun("paused")).toBe("active");
  });

  it("supersede is only allowed for inert states (paused/waiting_input)", () => {
    expect(canSupersedeActiveRun("paused")).toBe(true);
    expect(canSupersedeActiveRun("waiting_input")).toBe(true);
    expect(canSupersedeActiveRun("running")).toBe(false);
    expect(canSupersedeActiveRun("created")).toBe(false);
    expect(canSupersedeActiveRun("succeeded")).toBe(false);
  });
});
