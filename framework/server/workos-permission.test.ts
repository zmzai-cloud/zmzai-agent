import { describe, expect, it } from "vitest";

import { builtinDefaults, evaluateRules, type Ruleset } from "@zmzai/agent-framework";

/** 契约：workos 领域动作（改写用户笔记/待办）必须显式 ask。
 *  框架内置基线含 "*": "allow" 通配——resolver 不加显式规则时，自定义权限类
 *  会被通配吞掉免审批直接执行（真实链路上暴露过一次 update_note 直写）。 */
describe("workos permission baseline", () => {
  const workosAsk: Ruleset = [{ permission: "workos", pattern: "*", action: "ask" }];

  it("内置通配 allow 是缺陷基线（防止框架未来收紧后测试悄悄失效）", () => {
    expect(evaluateRules([builtinDefaults], "workos", "update_note:note_1")).toBe("allow");
  });

  it("resolver 注入 workos ask 后，改写需确认", () => {
    expect(evaluateRules([builtinDefaults, workosAsk], "workos", "update_note:note_1")).toBe("ask");
    expect(evaluateRules([builtinDefaults, workosAsk], "workos", "update_todo:todo_1")).toBe("ask");
  });

  it("workspace 显式 allow 规则（last-match-wins）仍可覆盖为放行", () => {
    const userOverride: Ruleset = [{ permission: "workos", pattern: "update_note:*", action: "allow" }];
    expect(evaluateRules([builtinDefaults, workosAsk, userOverride], "workos", "update_note:note_1")).toBe("allow");
    expect(evaluateRules([builtinDefaults, workosAsk, userOverride], "workos", "update_todo:todo_1")).toBe("ask");
  });

  it("workos ask 不影响其他权限类（bash ask / edit allow 基线不变）", () => {
    expect(evaluateRules([builtinDefaults, workosAsk], "bash", "ls")).toBe("ask");
    expect(evaluateRules([builtinDefaults, workosAsk], "edit", "a.ts")).toBe("allow");
  });
});
