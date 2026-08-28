import { describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@zmzai/agent-framework";

import { MEMORY_CONTEXT_HEADER, formatMemoryContext } from "./format";
import { recallMemoryContext } from "./recall-context";
import type { MemoryProvider } from "./provider";

const session = { id: "ses_x", workspaceId: "ws_1" } as SessionInfo;

function fakeProvider(recall: MemoryProvider["recall"]): MemoryProvider {
  return {
    ensureBank: vi.fn(),
    retain: vi.fn(),
    recall,
    deleteBank: vi.fn(),
    status: vi.fn(),
    reflect: vi.fn(),
  };
}

describe("recallMemoryContext", () => {
  it("facts 非空：格式化为带 header 的注入段", async () => {
    const provider = fakeProvider(vi.fn().mockResolvedValue(["用户偏好 dark mode", "部署脚本在 deploy/"]));
    const result = await recallMemoryContext(session, "怎么部署", provider);
    expect(result).toContain(MEMORY_CONTEXT_HEADER);
    expect(result).toBe(formatMemoryContext(["用户偏好 dark mode", "部署脚本在 deploy/"]));
    expect(provider.recall).toHaveBeenCalledWith({ bankId: "ws_1", query: "怎么部署" });
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
