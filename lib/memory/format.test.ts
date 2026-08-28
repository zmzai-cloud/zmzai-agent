import { describe, expect, it } from "vitest";

import {
  MEMORY_CONTEXT_HEADER,
  MEMORY_CONTEXT_MAX_CHARS,
  RETAIN_TRANSCRIPT_MAX_CHARS,
  formatMemoryContext,
  formatRetainTranscript,
} from "@/lib/memory/format";

describe("formatMemoryContext", () => {
  it("formats facts as header plus bullets", () => {
    const result = formatMemoryContext(["用户偏好函数式编程", "项目部署在 HK 服务器"]);
    expect(result).toBe(`${MEMORY_CONTEXT_HEADER}\n- 用户偏好函数式编程\n- 项目部署在 HK 服务器`);
  });

  it("returns undefined for empty or blank-only facts", () => {
    expect(formatMemoryContext([])).toBeUndefined();
    expect(formatMemoryContext(["  "])).toBeUndefined();
  });

  it("truncates the whole section at 4k chars without a dangling partial bullet", () => {
    const fact = "a".repeat(10_000);
    const result = formatMemoryContext([fact])!;
    expect(result.length).toBeLessThanOrEqual(MEMORY_CONTEXT_MAX_CHARS);
    expect(result.startsWith(MEMORY_CONTEXT_HEADER)).toBe(true);
    // 超长单条被就地截断，且不再追加后续条目。
    const second = formatMemoryContext([fact, "second-fact"])!;
    expect(second).toBe(result);
  });

  it("keeps full lines that fit and drops later lines that do not", () => {
    const facts = ["short-fact", "b".repeat(MEMORY_CONTEXT_MAX_CHARS)];
    const result = formatMemoryContext(facts)!;
    expect(result).toContain("- short-fact");
    expect(result.length).toBeLessThanOrEqual(MEMORY_CONTEXT_MAX_CHARS);
  });
});

describe("formatRetainTranscript", () => {
  it("joins user/assistant messages in order with role prefixes", () => {
    const result = formatRetainTranscript([
      { role: "user", text: "帮我修 bug" },
      { role: "assistant", text: "已修复" },
    ]);
    expect(result).toBe("user: 帮我修 bug\nassistant: 已修复");
  });

  it("skips blank messages and returns undefined when nothing remains", () => {
    expect(formatRetainTranscript([{ role: "user", text: "  " }])).toBeUndefined();
    expect(formatRetainTranscript([])).toBeUndefined();
  });

  it("hard-caps the transcript at 8k chars", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      role: "user" as const,
      text: `message-${index}-`.padEnd(400, "x"),
    }));
    const result = formatRetainTranscript(messages)!;
    expect(result.length).toBe(RETAIN_TRANSCRIPT_MAX_CHARS);
  });
});
