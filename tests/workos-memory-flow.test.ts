import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionInfo } from "@zmzai/agent-framework";

const fixture = vi.hoisted(() => ({
  provider: null as import("@/lib/memory/provider").MemoryProvider | null,
  states: new Map<string, {
    runId: string; sessionId: string; bankId: string;
    recall: { status: string; hits: Array<{ memoryId?: string; text: string }>; observedAt: string | null };
    retention: { status: string; updatedAt: string | null };
  }>(),
  sessions: new Map<string, { id: string; userId: string; workspaceId: string; title: string }>(),
  runs: new Map<string, { runId: string; sessionId: string; workspaceId: string; userId: string; status: string }>(),
  workspaces: new Map<string, string>(),
  events: [] as string[],
}));

vi.mock("@/lib/memory/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/memory/provider")>();
  return { ...original, getMemoryProvider: () => fixture.provider };
});
vi.mock("@/lib/memory/events", () => ({
  recordMemoryEvent: vi.fn(async (input: { runId: string; sessionId: string; bankId: string; type: string; payload: { hits?: Array<{ memoryId?: string; text: string }> } }) => {
    const state = fixture.states.get(input.runId) ?? {
      runId: input.runId, sessionId: input.sessionId, bankId: input.bankId,
      recall: { status: "pending", hits: [], observedAt: null },
      retention: { status: "not_started", updatedAt: null },
    };
    if (input.type === "memory.recall_succeeded") {
      state.recall = { status: input.payload.hits?.length ? "hit" : "empty", hits: input.payload.hits ?? [], observedAt: new Date().toISOString() };
    } else if (input.type === "memory.recall_unavailable" || input.type === "memory.recall_disabled") {
      state.recall = { status: input.type.slice("memory.recall_".length), hits: [], observedAt: new Date().toISOString() };
    }
    fixture.states.set(input.runId, state);
    fixture.events.push(input.type);
    return { seq: fixture.events.length };
  }),
  recordRetentionTransition: vi.fn(async (input: { runId: string; sessionId: string; bankId: string; type: string; from: string }) => {
    const state = fixture.states.get(input.runId) ?? {
      runId: input.runId, sessionId: input.sessionId, bankId: input.bankId,
      recall: { status: "pending", hits: [], observedAt: null },
      retention: { status: "not_started", updatedAt: null },
    };
    if (state.retention.status !== input.from) return false;
    state.retention = { status: input.type.slice("memory.retention_".length), updatedAt: new Date().toISOString() };
    fixture.states.set(input.runId, state);
    fixture.events.push(input.type);
    return true;
  }),
}));
vi.mock("@/lib/memory/run-state", () => ({
  readMemoryRunState: vi.fn(async (runId: string) => fixture.states.get(runId) ?? null),
  settleStaleRetention: vi.fn(async (runId: string, now: Date) => {
    const state = fixture.states.get(runId)!;
    if (state.retention.status === "pending" && Date.parse(state.retention.updatedAt ?? "") <= now.getTime() - 10_000) {
      state.retention = { status: "unknown", updatedAt: now.toISOString() };
      fixture.events.push("memory.retention_unknown");
    }
    return state;
  }),
  compareAndSetRetention: vi.fn(async (input: { runId: string; from: string; to: string; at: Date }) => {
    const state = fixture.states.get(input.runId);
    if (!state || state.retention.status !== input.from) return null;
    state.retention = { status: input.to, updatedAt: input.at.toISOString() };
    return state;
  }),
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: () => ({ WORKOS_SERVICE_SECRET_CURRENT: "local-test-secret" }) }));
vi.mock("@/lib/database/mongodb", () => ({ connectMongo: vi.fn(async () => undefined) }));
vi.mock("@/framework/core/runtime/runner", () => ({ defaultStore: {
  getSession: async (id: string) => fixture.sessions.get(id) ?? null,
  getMessages: async () => [],
} }));
vi.mock("@/framework/core/events/bus", () => ({ subscribeFrameworkEvents: vi.fn(async function* () {}) }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { findOne: (query: { workspaceId: string; userId: string }) => ({ lean: async () =>
  fixture.workspaces.get(query.workspaceId) === query.userId ? { workspaceId: query.workspaceId } : null,
}) } }));
vi.mock("@/models/run", () => ({ RunModel: {
  exists: async () => false,
  findOne: (query: { runId?: string; sessionId?: string; workspaceId?: string; userId: string }) => {
    const result = [...fixture.runs.values()].reverse().find((run) => run.userId === query.userId &&
      (query.runId === undefined || run.runId === query.runId) &&
      (query.sessionId === undefined || run.sessionId === query.sessionId) &&
      (query.workspaceId === undefined || run.workspaceId === query.workspaceId)) ?? null;
    const chain = { lean: async () => result, sort: () => chain };
    return chain;
  },
} }));

import { beginMemoryAttempt, takeMemoryAttempt } from "@/lib/memory/attempt-run";
import { clearRetainInFlightForTest, createMemoryRetainHook } from "@/lib/memory/retain-hook";
import { createHindsightMemoryProvider, RETAIN_TIMEOUT_MS, type HindsightLike } from "@/lib/memory/provider";
import { recallMemoryContext, type MemoryRecallReceipt } from "@/lib/memory/recall-context";
import { recordMemoryEvent } from "@/lib/memory/events";
import { GET as readWorkosSession } from "@/app/api/internal/workos/sessions/[sessionId]/route";
import { GET as readWorkosRunEvents } from "@/app/api/internal/workos/runs/[runId]/events/route";

const ownerA = "507f1f77bcf86cd799439011";
const ownerB = "507f1f77bcf86cd799439012";
const fact = "Preview fixture: prefer staging before release";
const originalEnv = { url: process.env.HINDSIGHT_API_URL, enabled: process.env.HINDSIGHT_ENABLED };

function makeBankClient(): HindsightLike {
  const banks = new Map<string, Array<{ id: string; text: string }>>();
  return {
    createBank: async (bankId) => { banks.set(bankId, banks.get(bankId) ?? []); },
    retain: async (bankId, content) => { banks.set(bankId, [...(banks.get(bankId) ?? []), { id: `mem_${bankId}`, text: content }]); },
    recall: async (bankId) => ({ results: banks.get(bankId) ?? [] }),
    deleteBank: async (bankId) => { banks.delete(bankId); },
    listMemories: async (bankId) => ({ total: banks.get(bankId)?.length ?? 0 }),
  };
}

function register(owner: string, workspaceId: string, sessionId: string, runId: string) {
  fixture.workspaces.set(workspaceId, owner);
  fixture.sessions.set(sessionId, { id: sessionId, userId: owner, workspaceId, title: "Fixture conversation" });
  fixture.runs.set(runId, { runId, sessionId, workspaceId, userId: owner, status: "succeeded" });
  return { id: sessionId, workspaceId, userId: owner } as SessionInfo;
}

async function recall(session: SessionInfo, runId: string, prompt = "How should this be released?") {
  let receipt: MemoryRecallReceipt | undefined;
  const context = await recallMemoryContext(session, prompt, fixture.provider!, async (next) => {
    receipt = next;
    await recordMemoryEvent({ runId, sessionId: session.id, bankId: session.workspaceId,
      type: next.status === "disabled" ? "memory.recall_disabled" : next.status === "unavailable" ? "memory.recall_unavailable" : "memory.recall_succeeded",
      payload: next.status === "hit" || next.status === "empty" ? { hits: next.hits } : {},
    });
  });
  return { context, receipt };
}

async function read(sessionId: string, owner: string) {
  const request = new NextRequest(`http://localhost/api/internal/workos/sessions/${sessionId}?userId=${owner}`, { headers: { authorization: "Bearer local-test-secret" } });
  return readWorkosSession(request, { params: Promise.resolve({ sessionId }) });
}

async function readRun(runId: string, owner: string) {
  const request = new NextRequest(`http://localhost/api/internal/workos/runs/${runId}/events?userId=${owner}`, { headers: { authorization: "Bearer local-test-secret" } });
  return readWorkosRunEvents(request, { params: Promise.resolve({ runId }) });
}

beforeEach(() => {
  fixture.states.clear(); fixture.sessions.clear(); fixture.runs.clear(); fixture.workspaces.clear(); fixture.events.length = 0;
  clearRetainInFlightForTest();
  process.env.HINDSIGHT_API_URL = "http://fake-hindsight.invalid";
  process.env.HINDSIGHT_ENABLED = "true";
  fixture.provider = createHindsightMemoryProvider({ apiUrl: "http://fake-hindsight.invalid", clientFactory: makeBankClient });
});
afterEach(() => {
  process.env.HINDSIGHT_API_URL = originalEnv.url;
  process.env.HINDSIGHT_ENABLED = originalEnv.enabled;
  vi.useRealTimers();
});

describe("WorkOS Memory release flow", () => {
  it("retains in owner A's bank, recalls on a later turn, and isolates owner B's bank and route", async () => {
    const first = register(ownerA, "ws_a", "ses_a", "run_a1");
    const other = register(ownerB, "ws_b", "ses_b", "run_b1");
    beginMemoryAttempt(first.id, "run_a1");
    await createMemoryRetainHook().onRunEnd!({ sessionId: first.id, workspaceId: first.workspaceId, agent: "default", ok: true, aborted: false,
      newMessages: [{ role: "user", text: fact }, { role: "assistant", text: "Use staging first." }] });
    await vi.waitFor(() => expect(fixture.states.get("run_a1")?.retention.status).toBe("succeeded"));
    expect((await read("ses_a", ownerA)).status).toBe(200);
    const retained = await (await read("ses_a", ownerA)).json();
    expect(retained.memory.retention.status).toBe("succeeded");

    // Continuing the same conversation creates a later Run, not a new session.
    const continued = register(ownerA, "ws_a", first.id, "run_a2");
    const secondTurn = await recall(continued, "run_a2");
    expect(secondTurn.context).toContain(fact);
    expect(secondTurn.receipt?.status).toBe("hit");
    const secondBody = await (await read(first.id, ownerA)).json();
    expect(secondBody.session.id).toBe(first.id);
    expect(secondBody.latestRun.runId).toBe("run_a2");
    expect(secondBody.memory.recall.status).toBe("hit");
    expect(secondBody.memory.recall.hits[0].text).toContain(fact);
    expect(secondBody.memory.retention.status).toBe("not_started");

    const otherWorkspace = await recall(other, "run_b1");
    expect(otherWorkspace.context).toBeUndefined();
    expect(otherWorkspace.receipt?.status).toBe("empty");
    expect((await (await read("ses_b", ownerB)).json()).memory.recall.status).toBe("empty");
    const otherUserRun = await readRun("run_a2", ownerB);
    expect(otherUserRun.status).toBe(404);
    expect(await otherUserRun.text()).not.toContain(fact);
    expect((await read(first.id, ownerB)).status).toBe(404);
  });

  it.each(["down", "zero hits", "retained timeout", "empty transcript", "disabled"] as const)("reports %s truthfully", async (scenario) => {
    const session = register(ownerA, "ws_a", "ses_case", "run_case");
    const client = makeBankClient();
    if (scenario === "down") client.recall = async () => { throw new Error("fake bank offline"); };
    if (scenario === "retained timeout") client.retain = async () => new Promise<never>(() => undefined);
    fixture.provider = createHindsightMemoryProvider({ apiUrl: "http://fake-hindsight.invalid", clientFactory: () => client });
    if (scenario === "disabled") process.env.HINDSIGHT_ENABLED = "false";
    const result = await recall(session, "run_case");
    expect(result.receipt?.status).toBe(scenario === "down" ? "unavailable" : scenario === "disabled" ? "disabled" : "empty");
    expect(result.context).toBeUndefined();
    if (scenario === "retained timeout") {
      // Exercise the real provider timeout without waiting five wall-clock seconds.
      vi.useFakeTimers();
    }
    beginMemoryAttempt(session.id, "run_case");
    await createMemoryRetainHook().onRunEnd!({ sessionId: session.id, workspaceId: session.workspaceId, agent: "default", ok: true, aborted: false,
      newMessages: scenario === "empty transcript" ? [] : [{ role: "user", text: fact }] });
    if (scenario === "retained timeout") await vi.advanceTimersByTimeAsync(RETAIN_TIMEOUT_MS);
    const expected = scenario === "empty transcript" ? "skipped" : scenario === "disabled" ? "disabled" : scenario === "retained timeout" ? "unknown" : "succeeded";
    if (scenario !== "retained timeout") await vi.waitFor(() => expect(fixture.states.get("run_case")?.retention.status).toBe(expected));
    expect((await (await read("ses_case", ownerA)).json()).memory).toMatchObject({ recall: { status: result.receipt?.status }, retention: { status: expected } });
  });

  it("reconciles stale pending on authenticated read and never silently retries", async () => {
    register(ownerA, "ws_a", "ses_stale", "run_stale");
    fixture.states.set("run_stale", { runId: "run_stale", sessionId: "ses_stale", bankId: "ws_a", recall: { status: "empty", hits: [], observedAt: null },
      retention: { status: "pending", updatedAt: new Date(Date.now() - 11_000).toISOString() } });
    const body = await (await read("ses_stale", ownerA)).json();
    expect(body.memory.retention.status).toBe("unknown");
    expect(fixture.events).toEqual(["memory.retention_unknown"]);
    expect((await (await read("ses_stale", ownerA)).json()).memory.retention.status).toBe("unknown");
    expect(fixture.events).toEqual(["memory.retention_unknown"]);
  });
});
