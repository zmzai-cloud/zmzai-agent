import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@zmzai/agent-framework";

const mocks = vi.hoisted(() => ({
  isMemoryConfigured: vi.fn(() => true),
  recall: vi.fn(),
  getMemoryAttempt: vi.fn(),
  readMemoryRunState: vi.fn(),
}));

vi.mock("./provider", () => ({
  isMemoryConfigured: mocks.isMemoryConfigured,
  getMemoryProvider: () => ({ recall: mocks.recall }),
}));
vi.mock("./attempt-run", () => ({ getMemoryAttempt: mocks.getMemoryAttempt }));
vi.mock("./run-state", () => ({ readMemoryRunState: mocks.readMemoryRunState }));

import { memorySearchTool, resolveMemoryTools } from "./search-tool";

const ctx = { sessionId: "ses_1", workspaceId: "ws_1", userId: "u1" } as ToolContext;

function run(args: { query: string; limit?: number }) {
  return memorySearchTool.execute({ limit: 8, ...args }, ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isMemoryConfigured.mockReturnValue(true);
  mocks.getMemoryAttempt.mockReturnValue("run_1");
  mocks.readMemoryRunState.mockResolvedValue(null);
  mocks.recall.mockResolvedValue([
    { memoryId: "mem_a", text: "部署走 HK 服务器 pm2", score: 0.91 },
    { memoryId: "mem_b", text: "muzhi 不接 theme", score: 0.72 },
  ]);
});

describe("memory_search", () => {
  it("returns hits with ids and marks status hit", async () => {
    const result = await run({ query: "部署方式" });
    expect(result.output).toContain("[mem_a] 部署走 HK 服务器 pm2 (0.91)");
    expect(result.output).toContain("标注 [memoryId]");
    expect(result.metadata).toMatchObject({ status: "hit", count: 2, deduped: 0 });
    expect(mocks.recall).toHaveBeenCalledWith({ bankId: "ws_1", query: "部署方式", maxFacts: 8, timeoutMs: 1500 });
  });

  it("drops hits already injected at task start", async () => {
    mocks.readMemoryRunState.mockResolvedValue({ recall: { hits: [{ memoryId: "mem_a", text: "部署走 HK" }] } });
    const result = await run({ query: "部署方式" });
    expect(result.output).not.toContain("mem_a");
    expect(result.output).toContain("mem_b");
    expect(result.metadata).toMatchObject({ status: "hit", count: 1, deduped: 1 });
  });

  it("reports deduped when every hit was already injected", async () => {
    mocks.readMemoryRunState.mockResolvedValue({
      recall: { hits: [{ memoryId: "mem_a", text: "a" }, { memoryId: "mem_b", text: "b" }] },
    });
    const result = await run({ query: "部署方式" });
    expect(result.output).toContain("已在本次任务的背景记忆中注入");
    expect(result.metadata).toMatchObject({ status: "deduped", count: 0, deduped: 2 });
  });

  it("skips dedup when there is no bound attempt", async () => {
    mocks.getMemoryAttempt.mockReturnValue(null);
    const result = await run({ query: "部署方式" });
    expect(mocks.readMemoryRunState).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({ status: "hit", count: 2 });
  });

  it("degrades to unavailable without throwing when recall fails", async () => {
    mocks.recall.mockResolvedValue(null);
    const result = await run({ query: "部署方式" });
    expect(result.output).toContain("暂不可用");
    expect(result.metadata).toMatchObject({ status: "unavailable" });
  });

  it("does not expose the tool when memory is not configured", async () => {
    mocks.isMemoryConfigured.mockReturnValue(false);
    expect(resolveMemoryTools()).toEqual([]);
    const result = await run({ query: "部署方式" });
    expect(result.metadata).toMatchObject({ status: "disabled" });
    expect(mocks.recall).not.toHaveBeenCalled();
  });

  it("truncates oversized facts and the total output", async () => {
    mocks.recall.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({ memoryId: `m${index}`, text: "x".repeat(1000), score: 0.5 })),
    );
    const result = await run({ query: "长文本" });
    expect(result.output.length).toBeLessThanOrEqual(3_200);
    expect(result.output).toContain("未展开");
  });
});
