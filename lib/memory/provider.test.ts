import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECALL_TIMEOUT_MS,
  RETAIN_TIMEOUT_MS,
  createHindsightMemoryProvider,
  createNoopMemoryProvider,
  getMemoryProvider,
  isMemoryConfigured,
  resetMemoryProviderForTest,
  type HindsightLike,
} from "@/lib/memory/provider";

function makeClient(overrides: Partial<HindsightLike> = {}): HindsightLike {
  return {
    createBank: vi.fn().mockResolvedValue({}),
    retain: vi.fn().mockResolvedValue({ success: true }),
    recall: vi.fn().mockResolvedValue({ results: [{ text: " fact-a " }, { text: "fact-b" }] }),
    deleteBank: vi.fn().mockResolvedValue(undefined),
    listMemories: vi.fn().mockResolvedValue({ items: [], total: 7, limit: 1, offset: 0 }),
    ...overrides,
  };
}

describe("noop memory provider", () => {
  it("degrades silently: recall is null, writes resolve, status unavailable", async () => {
    const provider = createNoopMemoryProvider();
    await expect(provider.ensureBank("ws_x")).resolves.toBeUndefined();
    await expect(provider.retain({ bankId: "ws_x", content: "c", context: "t" })).resolves.toBeUndefined();
    await expect(provider.deleteBank("ws_x")).resolves.toBeUndefined();
    await expect(provider.recall({ bankId: "ws_x", query: "q" })).resolves.toBeNull();
    await expect(provider.status("ws_x")).resolves.toEqual({ available: false, factCount: null });
    await expect(provider.reflect({ bankId: "ws_x", query: "q" })).rejects.toThrow("NOT_IMPLEMENTED");
  });
});

describe("hindsight memory provider", () => {
  it("maps recall results to trimmed fact texts and slices to maxFacts", async () => {
    const client = makeClient({
      recall: vi.fn().mockResolvedValue({ results: Array.from({ length: 20 }, (_, index) => ({ text: `f${index}` })) }),
    });
    const provider = createHindsightMemoryProvider({ apiUrl: "http://127.0.0.1:8888", clientFactory: () => client });
    const facts = await provider.recall({ bankId: "ws_x", query: "q" });
    expect(facts).toHaveLength(12);
    expect(facts![0]).toBe("f0");
    await expect(provider.recall({ bankId: "ws_x", query: "q", maxFacts: 2 })).resolves.toEqual(["f0", "f1"]);
  });

  it("passes context to retain and does not throw when the client rejects", async () => {
    const client = makeClient({ retain: vi.fn().mockRejectedValue(new Error("boom")) });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = createHindsightMemoryProvider({ apiUrl: "http://127.0.0.1:8888", clientFactory: () => client });
    await expect(
      provider.retain({ bankId: "ws_x", content: "c", context: "session s1 run r1" }),
    ).resolves.toBeUndefined();
    expect(client.retain).toHaveBeenCalledWith("ws_x", "c", { context: "session s1 run r1", signal: expect.anything() });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("is idempotent per bank for ensureBank", async () => {
    const client = makeClient();
    const provider = createHindsightMemoryProvider({ apiUrl: "http://127.0.0.1:8888", clientFactory: () => client });
    await provider.ensureBank("ws_x");
    await provider.ensureBank("ws_x");
    expect(client.createBank).toHaveBeenCalledTimes(1);
    await provider.ensureBank("ws_y");
    expect(client.createBank).toHaveBeenCalledTimes(2);
  });

  it("exposes bank stats via status", async () => {
    const provider = createHindsightMemoryProvider({ apiUrl: "http://127.0.0.1:8888", clientFactory: () => makeClient() });
    await expect(provider.status("ws_x")).resolves.toEqual({ available: true, factCount: 7 });
    const failing = createHindsightMemoryProvider({
      apiUrl: "http://127.0.0.1:8888",
      clientFactory: () => makeClient({ listMemories: vi.fn().mockRejectedValue(new Error("down")) }),
    });
    await expect(failing.status("ws_x")).resolves.toEqual({ available: false, factCount: null });
  });

  it("degrades recall/retain on timeout without throwing", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = createHindsightMemoryProvider({
      apiUrl: "http://127.0.0.1:8888",
      clientFactory: () =>
        makeClient({
          recall: () => new Promise(() => undefined),
          retain: () => new Promise(() => undefined),
        }),
    });
    const recallPromise = provider.recall({ bankId: "ws_x", query: "q" });
    const retainPromise = provider.retain({ bankId: "ws_x", content: "c", context: "t" });
    await vi.advanceTimersByTimeAsync(RETAIN_TIMEOUT_MS + 100);
    expect(await recallPromise).toBeNull();
    await expect(retainPromise).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(`[memory] recall timed out after ${RECALL_TIMEOUT_MS}ms failed for bank ws_x:`, undefined);
    vi.useRealTimers();
    warnSpy.mockRestore();
  });
});

describe("getMemoryProvider factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMemoryProviderForTest();
  });

  afterEach(() => {
    process.env.HINDSIGHT_API_URL = originalEnv.HINDSIGHT_API_URL;
    process.env.HINDSIGHT_ENABLED = originalEnv.HINDSIGHT_ENABLED;
    resetMemoryProviderForTest();
  });

  it("returns noop without URL, with explicit false, and caches the instance", () => {
    delete process.env.HINDSIGHT_API_URL;
    delete process.env.HINDSIGHT_ENABLED;
    const first = getMemoryProvider();
    expect(first.recall({ bankId: "ws_x", query: "q" })).resolves.toBeNull();
    expect(getMemoryProvider()).toBe(first);

    process.env.HINDSIGHT_API_URL = "http://127.0.0.1:8888";
    process.env.HINDSIGHT_ENABLED = "false";
    resetMemoryProviderForTest();
    expect(isMemoryConfigured()).toBe(false);
    expect(getMemoryProvider().status("ws_x")).resolves.toEqual({ available: false, factCount: null });
  });

  it("reports configured when URL present and not disabled", () => {
    process.env.HINDSIGHT_API_URL = "  http://127.0.0.1:8888  ";
    delete process.env.HINDSIGHT_ENABLED;
    expect(isMemoryConfigured()).toBe(true);
    process.env.HINDSIGHT_ENABLED = "true";
    expect(isMemoryConfigured()).toBe(true);
    process.env.HINDSIGHT_ENABLED = "false";
    expect(isMemoryConfigured()).toBe(false);
  });
});
