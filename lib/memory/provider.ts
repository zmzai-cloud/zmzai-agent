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
export type MemoryRecallHit = { memoryId?: string; text: string; score?: number };
export type MemoryRetainInput = { bankId: string; content: string; context: string };
export type MemoryRetainOutcome = "succeeded" | "failed" | "unknown";
export type MemoryStatus = { available: boolean; factCount: number | null };

export interface MemoryProvider {
  /** 幂等建 bank（createBank 为 create-or-update 语义，天然幂等）。 */
  ensureBank(bankId: string): Promise<void>;
  /** 沉淀记忆。失败/超时静默（warn），永不抛出。 */
  retain(input: MemoryRetainInput): Promise<void>;
  retainWithOutcome(input: MemoryRetainInput): Promise<MemoryRetainOutcome>;
  /** 语义召回。可达但无结果返回 []；不可用返回 null。 */
  recall(input: MemoryRecallInput): Promise<MemoryRecallHit[] | null>;
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
  ): Promise<{ results: Array<{ id?: string; text: string; score?: number; scores?: { final: number } | null }> }>;
  deleteBank(bankId: string): Promise<unknown>;
  listMemories(bankId: string, options: { limit: number }): Promise<{ total: number }>;
}

/** 超时可经环境变量放宽（本地开发走 SSH 隧道连 HK hindsight 时，
 *  单程 RTT ~300ms，800ms 默认预算不够）。生产默认保持紧凑值。 */
function envTimeoutMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return fallbackMs;
  const value = Number(raw);
  return value >= 100 && value <= 120_000 ? value : fallbackMs;
}

export const RECALL_TIMEOUT_MS = envTimeoutMs("HINDSIGHT_RECALL_TIMEOUT_MS", 800);
export const RETAIN_TIMEOUT_MS = envTimeoutMs("HINDSIGHT_RETAIN_TIMEOUT_MS", 5_000);
/** recall 请求的 token 预算（hindsight SDK 无 maxFacts 参数，用 token 预算 + slice 控制）。 */
export const RECALL_MAX_TOKENS = 2_000;
export const RECALL_DEFAULT_MAX_FACTS = 12;

function warn(operation: string, bankId: string): void {
  // Client errors can contain request or fact text; logs carry metadata only.
  console.warn(`[memory] ${operation} failed for bank ${bankId}`);
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
      run(controller.signal).catch(() => {
        if (!timedOut) warn(operation, bankId);
        return fallback;
      }),
      new Promise<T>((resolve) =>
        setTimeout(() => {
          warn(`${operation} timed out after ${timeoutMs}ms`, bankId);
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
    retainWithOutcome: () => Promise.resolve("unknown"),
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

  const retainWithOutcome = async ({ bankId, content, context }: MemoryRetainInput): Promise<MemoryRetainOutcome> => {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<MemoryRetainOutcome>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        warn(`retain timed out after ${RETAIN_TIMEOUT_MS}ms`, bankId);
        resolve("unknown");
      }, RETAIN_TIMEOUT_MS);
    });
    const request = Promise.resolve().then(() => getClient().retain(bankId, content, { context, signal: controller.signal }))
      .then((): MemoryRetainOutcome => "succeeded")
      .catch((error: unknown): MemoryRetainOutcome => {
        if (timedOut || (error instanceof Error && error.name === "AbortError")) return "unknown";
        warn("retain", bankId);
        return "failed";
      });
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
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
    retain: (input) => retainWithOutcome(input).then(() => undefined),
    retainWithOutcome,
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
      return response.results
        .map((result): MemoryRecallHit => {
          const text = result.text.trim();
          const score = result.scores?.final ?? result.score;
          return {
            text,
            ...(typeof result.id === "string" && result.id.length > 0 ? { memoryId: result.id } : {}),
            ...(typeof score === "number" && Number.isFinite(score) ? { score } : {}),
          };
        })
        .filter((result) => result.text.length > 0)
        .slice(0, limit);
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
  cachedProvider = apiUrl && isMemoryConfigured() ? createHindsightMemoryProvider({ apiUrl }) : createNoopMemoryProvider();
  return cachedProvider;
}

/** 测试专用：重置单例与 env 判定。 */
export function resetMemoryProviderForTest(): void {
  cachedProvider = undefined;
}
