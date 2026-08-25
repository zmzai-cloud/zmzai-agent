import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  findOne: vi.fn(),
  claimIdempotency: vi.fn(),
  launchAutomation: vi.fn(),
  getProjectAccess: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/idempotency", () => ({
  claimIdempotency: mocks.claimIdempotency,
  IdempotencyError: class IdempotencyError extends Error { constructor(public readonly code: string) { super(code); this.name = "IdempotencyError"; } },
}));
vi.mock("@/lib/automation-execution", () => ({ launchAutomation: mocks.launchAutomation }));
vi.mock("@/lib/project-access", () => ({ canRunProject: vi.fn(() => true), getProjectAccess: mocks.getProjectAccess }));
vi.mock("@/models/automation", () => ({ AutomationModel: { findOne: mocks.findOne } }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => "12345678-1234-1234-1234-123456789abc" };
});

import { POST } from "@/app/api/automations/[automationId]/run/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("POST /api/automations/:automationId/run", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ automationId: "aut_1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when automation does not exist", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    const res = await POST(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ automationId: "aut_missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when automation is paused", async () => {
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "aut_1", userId: "user_1", status: "paused", projectId: null }) });
    const res = await POST(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ automationId: "aut_1" }) });
    expect(res.status).toBe(409);
  });

  it("launches the automation and returns 202", async () => {
    const automation = { automationId: "aut_1", userId: "user_1", status: "active", projectId: null, name: "Test", goal: "Do something", workspaceId: "ws_1" };
    mocks.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(automation) });
    mocks.claimIdempotency.mockResolvedValue({ replayed: false, resourceId: "ses_abc123" });
    mocks.launchAutomation.mockResolvedValue({ session: { id: "ses_abc123" }, task: { taskId: "task_1" }, run: { runId: "run_1" } });

    const res = await POST(new NextRequest("http://localhost", { method: "POST" }), { params: Promise.resolve({ automationId: "aut_1" }) });
    expect(res.status).toBe(202);
    expect(mocks.launchAutomation).toHaveBeenCalledWith(expect.objectContaining({ automation, source: "manual", sessionId: "ses_abc123" }));
  });
});
