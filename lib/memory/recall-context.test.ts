import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@zmzai/agent-framework";

import { MEMORY_CONTEXT_HEADER, formatMemoryContext } from "./format";
import { recallMemoryContext } from "./recall-context";
import type { MemoryProvider } from "./provider";

const session = { id: "ses_x", workspaceId: "ws_1" } as SessionInfo;

function fakeProvider(recall: MemoryProvider["recall"]): MemoryProvider {
  return {
    ensureBank: vi.fn(),
    retain: vi.fn(),
    retainWithOutcome: vi.fn(),
    recall,
    deleteBank: vi.fn(),
    status: vi.fn(),
    reflect: vi.fn(),
  };
}

describe("recallMemoryContext", () => {
  const originalUrl = process.env.HINDSIGHT_API_URL;
  const originalEnabled = process.env.HINDSIGHT_ENABLED;
  beforeEach(() => {
    process.env.HINDSIGHT_API_URL = "http://127.0.0.1:8888";
    process.env.HINDSIGHT_ENABLED = "true";
  });
  afterEach(() => {
    process.env.HINDSIGHT_API_URL = originalUrl;
    process.env.HINDSIGHT_ENABLED = originalEnabled;
  });

  it("facts 非空：格式化为带 header 的注入段", async () => {
    const provider = fakeProvider(vi.fn().mockResolvedValue([{ text: "用户偏好 dark mode" }, { text: "部署脚本在 deploy/" }]));
    const result = await recallMemoryContext(session, "怎么部署", provider);
    expect(result).toContain(MEMORY_CONTEXT_HEADER);
    expect(result).toBe(formatMemoryContext(["用户偏好 dark mode", "部署脚本在 deploy/"]));
    expect(provider.recall).toHaveBeenCalledWith({ bankId: "ws_1", query: "怎么部署" });
  });

  it("reports the bounded projection of the exact ordered facts injected into the model", async () => {
    const hits = Array.from({ length: 12 }, (_, index) => ({ memoryId: `mem_${index}`, text: `fact-${index}-` + "x".repeat(300) }));
    const provider = fakeProvider(vi.fn().mockResolvedValue(hits));
    const receipts: unknown[] = [];
    const context = await recallMemoryContext(session, "部署偏好", provider, (receipt) => { receipts.push(receipt); });
    expect(context).toBeDefined();
    expect(context!.length).toBeLessThanOrEqual(4_000);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ bankId: "ws_1", status: "hit" });
    const preview = (receipts[0] as { hits: Array<{ memoryId: string; text: string }> }).hits;
    expect(preview).toHaveLength(8);
    expect(preview.map((hit) => hit.memoryId)).toEqual(hits.slice(0, 8).map((hit) => hit.memoryId));
    expect(preview.every((hit) => hit.text.length <= 240 && context!.includes(hit.text))).toBe(true);
    expect(provider.recall).toHaveBeenCalledTimes(1);
  });

  it("keeps bank identity isolated and excludes facts beyond the context cutoff", async () => {
    const provider = fakeProvider(vi.fn()
      .mockResolvedValueOnce([{ memoryId: "first", text: "a".repeat(10_000) }, { memoryId: "excluded", text: "must not appear" }])
      .mockResolvedValueOnce([{ memoryId: "second", text: "other bank fact" }]));
    const receipts: Array<{ bankId: string; hits: Array<{ memoryId?: string; text: string }> }> = [];
    const firstContext = await recallMemoryContext(session, "q", provider, (receipt) => { receipts.push(receipt); });
    const secondSession = { ...session, workspaceId: "ws_2" };
    const secondContext = await recallMemoryContext(secondSession, "q", provider, (receipt) => { receipts.push(receipt); });
    expect(firstContext).toHaveLength(4_000);
    expect(firstContext).not.toContain("must not appear");
    expect(receipts[0].hits.map((hit) => hit.memoryId)).toEqual(["first"]);
    expect(receipts[0].hits[0].text).toHaveLength(240);
    expect(secondContext).toContain("other bank fact");
    expect(receipts.map((receipt) => receipt.bankId)).toEqual(["ws_1", "ws_2"]);
    expect(provider.recall).toHaveBeenNthCalledWith(1, { bankId: "ws_1", query: "q" });
    expect(provider.recall).toHaveBeenNthCalledWith(2, { bankId: "ws_2", query: "q" });
  });

  it("does not block injected context when a receipt callback rejects", async () => {
    const provider = fakeProvider(vi.fn().mockResolvedValue([{ text: "prefer staging first" }]));
    await expect(recallMemoryContext(session, "q", provider, async () => {
      throw new Error("database down");
    })).resolves.toContain("prefer staging first");
  });

  it("distinguishes empty, unavailable, disabled, and thrown recall", async () => {
    const receipt = vi.fn();
    await recallMemoryContext(session, "q", fakeProvider(vi.fn().mockResolvedValue([])), receipt);
    expect(receipt).toHaveBeenLastCalledWith({ bankId: "ws_1", status: "empty", hits: [] });
    await recallMemoryContext(session, "q", fakeProvider(vi.fn().mockResolvedValue(null)), receipt);
    expect(receipt).toHaveBeenLastCalledWith({ bankId: "ws_1", status: "unavailable", hits: [] });
    await recallMemoryContext(session, "q", fakeProvider(vi.fn().mockRejectedValue(new Error("secret fact"))), receipt);
    expect(receipt).toHaveBeenLastCalledWith({ bankId: "ws_1", status: "unavailable", hits: [] });
    process.env.HINDSIGHT_ENABLED = "false";
    const disabledProvider = fakeProvider(vi.fn());
    await recallMemoryContext(session, "q", disabledProvider, receipt);
    expect(receipt).toHaveBeenLastCalledWith({ bankId: "ws_1", status: "disabled", hits: [] });
    expect(disabledProvider.recall).not.toHaveBeenCalled();
  });

  it("recall 返回 null（不可用/降级）：返回 undefined", async () => {
    const provider = fakeProvider(vi.fn().mockResolvedValue(null));
    await expect(recallMemoryContext(session, "随便", provider)).resolves.toBeUndefined();
  });

  it("recall 返回空数组：返回 undefined", async () => {
    const provider = fakeProvider(vi.fn().mockResolvedValue([]));
    await expect(recallMemoryContext(session, "随便", provider)).resolves.toBeUndefined();
  });

  it("recall 抛错：返回 undefined 不冒泡", async () => {
    const provider = fakeProvider(vi.fn().mockRejectedValue(new Error("网络炸了")));
    await expect(recallMemoryContext(session, "随便", provider)).resolves.toBeUndefined();
  });

  it("空 prompt：不触发 recall 直接返回 undefined", async () => {
    const recall = vi.fn().mockResolvedValue(["x"]);
    const provider = fakeProvider(recall);
    await expect(recallMemoryContext(session, "   ", provider)).resolves.toBeUndefined();
    expect(recall).not.toHaveBeenCalled();
  });
});
