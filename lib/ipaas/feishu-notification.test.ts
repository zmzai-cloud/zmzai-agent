import { describe, expect, it } from "vitest";

import { buildTaskCompletionCard } from "@/lib/ipaas/feishu-notification";

describe("feishu-notification", () => {
  describe("buildTaskCompletionCard", () => {
    it("builds success card with task title and summary", () => {
      const card = buildTaskCompletionCard({
        workspaceId: "ws_test",
        automationName: "每日报告",
        status: "succeeded",
        taskTitle: "生成周报",
        summary: "本周完成了 5 个任务",
        durationMs: 125_000,
      });

      expect(card.header).toEqual({
        title: { tag: "plain_text", content: "\u2705 任务完成" },
        template: "green",
      });

      const elements = card.elements as Array<Record<string, unknown>>;
      expect(elements.length).toBeGreaterThanOrEqual(4);

      const taskElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("生成周报");
      });
      expect(taskElement).toBeDefined();

      const durationElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("2 分 5 秒");
      });
      expect(durationElement).toBeDefined();

      const summaryElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("本周完成了 5 个任务");
      });
      expect(summaryElement).toBeDefined();
    });

    it("builds failure card with error message", () => {
      const card = buildTaskCompletionCard({
        workspaceId: "ws_test",
        automationName: "数据同步",
        status: "failed",
        taskTitle: "同步用户数据",
        error: "API 超时",
        durationMs: 30_000,
      });

      expect(card.header).toEqual({
        title: { tag: "plain_text", content: "\u274c 任务失败" },
        template: "red",
      });

      const elements = card.elements as Array<Record<string, unknown>>;
      const errorElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("API 超时");
      });
      expect(errorElement).toBeDefined();
    });

    it("omits duration when not provided", () => {
      const card = buildTaskCompletionCard({
        workspaceId: "ws_test",
        automationName: "测试",
        status: "succeeded",
      });

      const elements = card.elements as Array<Record<string, unknown>>;
      const durationElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("耗时");
      });
      expect(durationElement).toBeUndefined();
    });

    it("truncates long summary to 800 chars", () => {
      const longSummary = "a".repeat(1000);
      const card = buildTaskCompletionCard({
        workspaceId: "ws_test",
        automationName: "测试",
        status: "succeeded",
        summary: longSummary,
      });

      const elements = card.elements as Array<Record<string, unknown>>;
      const summaryElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("结果摘要");
      });
      const text = summaryElement?.text as Record<string, string> | undefined;
      expect(text?.content.length).toBeLessThan(900);
      expect(text?.content).toContain("...");
    });

    it("always includes hr and note footer", () => {
      const card = buildTaskCompletionCard({
        workspaceId: "ws_test",
        automationName: "最小测试",
        status: "failed",
      });

      const elements = card.elements as Array<Record<string, unknown>>;
      expect(elements.some((element) => element.tag === "hr")).toBe(true);

      const note = elements.find((element) => element.tag === "note");
      expect(note).toBeDefined();
    });

    it("formats seconds under 60 as plain seconds", () => {
      const card = buildTaskCompletionCard({
        workspaceId: "ws_test",
        automationName: "快速任务",
        status: "succeeded",
        durationMs: 15_000,
      });

      const elements = card.elements as Array<Record<string, unknown>>;
      const durationElement = elements.find((element) => {
        const text = element.text as Record<string, string> | undefined;
        return text?.content?.includes("耗时");
      });
      const text = durationElement?.text as Record<string, string> | undefined;
      expect(text?.content).toContain("15 秒");
    });
  });
});
