/**
 * 长期记忆 Provider 抽象（spec §2）。
 *
 * 接口只放在产品层 lib/memory/，framework 不感知 hindsight：
 * - hindsight 实现：@vectorize-io/hindsight-client 包装
 * - noop 实现：未配置/禁用/故障时的降级路径，代码结构与生产完全一致
 *
 * bank_id 直接使用 workspaceId 原值（自带 ws_ 前缀，全链路不加工）。
 *
 * 注：deleteBank 与 status 不在 spec §2 的接口清单里，但 bank 生命周期
 * （workspace 删除清理）与 UI 统计（记忆条数）需要它们，属必要补全。
 */

import { HindsightClient } from "@vectorize-io/hindsight-client";

export type MemoryRecallInput = { bankId: string; query: string; maxFacts?: number };
export type MemoryRetainInput = { bankId: string; content: string; context: string };
export type MemoryStatus = { available: boolean; factCount: number | null };

export interface MemoryProvider {
  /** 幂等建 bank（createBank 为 create-or-update 语义，天然幂等）。 */
  ensureBank(bankId: string): Promise<void>;
  /** 沉淀记忆。失败/超时静默（warn），永不抛出。 */
  retain(input: MemoryRetainInput): Promise<void>;
  /** 语义召回。返回事实文本列表；不可用/降级返回 null。 */
  recall(input: MemoryRecallInput): Promise<string[] | null>;
  /** 删除 bank（workspace 删除时 fire-and-forget）。 */
  deleteBank(bankId: string): Promise<void>;
  /** bank 状态与记忆条数（UI 展示用）。 */
  status(bankId: string): Promise<MemoryStatus>;
  /** 二阶段能力（spec 非目标），预留接口。 */
  reflect(input: MemoryRecallInput): Promise<never>;
}

/** hindsight-client 的最小适配面（便于测试注入 mock，也便于将来换薄 fetch 实现）。 */
export interface HindsightLike {
  createBank(bankId: string): Promise<unknown>;
  retain(bankId: string, content: string, options: { context?: string; signal?: AbortSignal }): Promise<unknown>;
  recall(
    bankId: string,
    query: string,
    options: { maxTokens?: number; signal?: AbortSignal },
  ): Promise<{ results: Array<{ text: string }> }>;
  deleteBank(bankId: string): Promise<unknown>;
  listMemories(bankId: string, options: { limit: number }): Promise<{ total: number }>;
}

export const RECALL_TIMEOUT_MS = 800;
export const RETAIN_TIMEOUT_MS = 5_000;
/** recall 请求的 token 预算（hindsight SDK 无 maxFacts 参数，用 token 预算 + slice 控制）。 */
export const RECALL_MAX_TOKENS = 2_000;
export const RECALL_DEFAULT_MAX_FACTS = 12;

function warn(operation: string, bankId: string, error: unknown): void {
  console.warn(`[memory] ${operation} failed for bank ${bankId}:`, error instanceof Error ? error.message : error);
}

/**
 * 带超时的旁路执行：永不抛出。超时或失败均返回 fallback。
 * 超时通过 AbortSignal 通知底层请求中断；竞速后未决的 run promise
 * 也必须被接住（超时路径下它以 abort 错误 reject，不能变成 unhandled rejection）。
 */
async function withTimeout<T>(
  bankId: string,
  operation: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await Promise.race([
      run(controller.signal).catch((error: unknown) => {
        if (!timedOut) warn(operation, bankId, error);
        return fallback;
      }),
      new Promise<T>((resolve) =>
        setTimeout(() => {
          warn(`${operation} timed out after ${timeoutMs}ms`, bankId, undefined);
          resolve(fallback);
        }, timeoutMs),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createNoopMemoryProvider(): MemoryProvider {
  return {
    ensureBank: () => Promise.resolve(),
    retain: () => Promise.resolve(),
    recall: () => Promise.resolve(null),
    deleteBank: () => Promise.resolve(),
    status: () => Promise.resolve({ available: false, factCount: null }),
    reflect: () => Promise.reject(new Error("NOT_IMPLEMENTED")),
  };
}

export function createHindsightMemoryProvider(deps: {
  apiUrl: string;
  clientFactory?: () => HindsightLike;
}): MemoryProvider {
  let client: HindsightLike | undefined;
  const ensuredBanks = new Set<string>();

  const getClient = (): HindsightLike => {
    client ??= deps.clientFactory ? deps.clientFactory() : (new HindsightClient({ baseUrl: deps.apiUrl }) as HindsightLike);
    return client;
  };

  return {
    ensureBank: (bankId) =>
      withTimeout(
        bankId,
        "ensureBank",
        RETAIN_TIMEOUT_MS,
        async () => {
          if (ensuredBanks.has(bankId)) return null;
          await getClient().createBank(bankId);
          ensuredBanks.add(bankId);
          return null;
        },
        null,
      ).then(() => undefined),
    retain: ({ bankId, content, context }) =>
      withTimeout(
        bankId,
        "retain",
        RETAIN_TIMEOUT_MS,
        (signal) => getClient().retain(bankId, content, { context, signal }).then(() => undefined),
        undefined,
      ),
    recall: async ({ bankId, query, maxFacts }) => {
      const limit = maxFacts ?? RECALL_DEFAULT_MAX_FACTS;
      const response = await withTimeout(
        bankId,
        "recall",
        RECALL_TIMEOUT_MS,
        (signal) => getClient().recall(bankId, query, { maxTokens: RECALL_MAX_TOKENS, signal }),
        null,
      );
      if (!response) return null;
      return response.results.slice(0, limit).map((result) => result.text.trim()).filter((text) => text.length > 0);
    },
    deleteBank: (bankId) =>
      withTimeout(
        bankId,
        "deleteBank",
        RETAIN_TIMEOUT_MS,
        () => getClient().deleteBank(bankId).then(() => undefined),
        undefined,
      ),
    status: async (bankId) => {
      const response = await withTimeout(
        bankId,
        "status",
        RECALL_TIMEOUT_MS,
        () => getClient().listMemories(bankId, { limit: 1 }),
        null,
      );
      return response ? { available: true, factCount: response.total } : { available: false, factCount: null };
    },
    reflect: () => Promise.reject(new Error("NOT_IMPLEMENTED")),
  };
}

/** 启用判定（供 UI/路由展示与测试）：配置了 URL 且未显式关闭。 */
export function isMemoryConfigured(): boolean {
  const apiUrl = process.env.HINDSIGHT_API_URL?.trim();
  return Boolean(apiUrl) && process.env.HINDSIGHT_ENABLED !== "false";
}

let cachedProvider: MemoryProvider | undefined;

/**
 * 进程级单例。未配置/禁用时全链路 noop。
 * 直接读 process.env（而非 getServerEnvironment）：记忆是旁路能力，
 * 不应因主 schema 校验失败而影响（也不应依赖）核心环境装配。
 */
export function getMemoryProvider(): MemoryProvider {
  if (cachedProvider) return cachedProvider;
  const apiUrl = process.env.HINDSIGHT_API_URL?.trim();
  cachedProvider = apiUrl ? createHindsightMemoryProvider({ apiUrl }) : createNoopMemoryProvider();
  return cachedProvider;
}

/** 测试专用：重置单例与 env 判定。 */
export function resetMemoryProviderForTest(): void {
  cachedProvider = undefined;
}
