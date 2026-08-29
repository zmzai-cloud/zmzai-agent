import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  SpanClosedEventSchema,
  UsageRecordedEventSchema,
  generateTraceId,
  resolveIncomingTraceId,
  type SpanClosedPayload,
  type SpanClosedEvent,
  type UsageRecordedPayload,
  type UsageRecordedEvent,
} from "@zmzai/contracts";

import { getServerEnvironment } from "@/config/env";

/**
 * 跨站埋点 helper（agent 侧）：
 * - runWithTrace：入口路由用 AsyncLocalStorage 绑定 trace（请求头透传或新生成）
 * - currentTraceId：出站调用（relay/sandbox）取当前 trace，没有则生成
 * - emitUsage / startSpan：usage.recorded 与 span.closed 事件推送
 *
 * 硬约束：绝不阻塞主流程 —— 150ms 超时、失败静默丢弃仅计数、不重试（v1 无持久化队列）。
 */

const EMIT_TIMEOUT_MS = 150;

const storage = new AsyncLocalStorage<{ traceId: string }>();

export function runWithTrace<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  const traceId = resolveIncomingTraceId(request.headers?.get("x-trace-id"));
  return storage.run({ traceId }, fn);
}

/** 当前请求绑定的 trace；不在请求上下文（如后台任务）时生成新的。 */
export function currentTraceId(): string {
  return storage.getStore()?.traceId ?? generateTraceId();
}

const stats = { sent: 0, failed: 0 };
export function telemetryStats() {
  return { ...stats };
}

function countFailure(reason: string): void {
  stats.failed += 1;
  if (process.env.NODE_ENV !== "production") console.debug(`[telemetry] emit failed: ${reason}`);
}

function ingest(events: Array<UsageRecordedEvent | SpanClosedEvent>): void {
  const env = getServerEnvironment();
  const url = env.BILLING_INGEST_URL;
  const key = env.BILLING_INGEST_KEY;
  if (!url || !key) return; // 未配置 → 静默跳过
  void fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ events }),
    signal: AbortSignal.timeout(EMIT_TIMEOUT_MS),
    cache: "no-store",
  })
    .then((res) => {
      if (!res.ok) countFailure(`http_${res.status}`);
      else stats.sent += events.length;
    })
    .catch(() => countFailure("network_or_timeout"));
}

export function emitUsage(payload: UsageRecordedPayload & { traceId?: string; actorId?: string | null }): void {
  const event = {
    id: randomUUID(),
    ...(payload.traceId ? { traceId: payload.traceId } : {}),
    service: "agent" as const,
    type: "usage.recorded" as const,
    actorId: payload.actorId ?? null,
    payload: {
      userId: payload.userId,
      product: payload.product,
      metric: payload.metric,
      amount: payload.amount,
      ...(payload.costMicros !== undefined ? { costMicros: payload.costMicros } : {}),
      ...(payload.meta ? { meta: payload.meta } : {}),
    },
    at: new Date().toISOString(),
  } satisfies UsageRecordedEvent;
  const parsed = UsageRecordedEventSchema.safeParse(event);
  if (!parsed.success) {
    countFailure("schema:usage");
    return;
  }
  ingest([parsed.data as UsageRecordedEvent]);
}

/** 开始一个 span；结束时调 end() 发 span.closed。绝不抛错。 */
export function startSpan(op: string, partial?: Partial<Pick<SpanClosedPayload, "parentSpanId">>) {
  const traceId = currentTraceId();
  const spanId = randomUUID();
  const startedAt = new Date();
  return {
    traceId,
    spanId,
    end(status: "ok" | "error", extra?: { tokens?: number; costMicros?: number }): void {
      const payload: SpanClosedPayload = {
        traceId,
        spanId,
        ...(partial?.parentSpanId ? { parentSpanId: partial.parentSpanId } : {}),
        service: "agent",
        op,
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        ...(extra?.tokens !== undefined ? { tokens: extra.tokens } : {}),
        ...(extra?.costMicros !== undefined ? { costMicros: extra.costMicros } : {}),
        status,
        startedAt: startedAt.toISOString(),
      };
      const event = {
        id: randomUUID(),
        traceId,
        service: "agent" as const,
        type: "span.closed" as const,
        actorId: null,
        payload,
        at: new Date().toISOString(),
      } satisfies SpanClosedEvent;
      const parsed = SpanClosedEventSchema.safeParse(event);
      if (!parsed.success) {
        countFailure("schema:span");
        return;
      }
      ingest([parsed.data as SpanClosedEvent]);
    },
  };
}
