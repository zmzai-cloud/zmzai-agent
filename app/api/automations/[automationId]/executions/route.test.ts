import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  automationFindOne: vi.fn(),
  executionFind: vi.fn(),
  getProjectAccess: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/lib/project-access", () => ({ getProjectAccess: mocks.getProjectAccess }));
vi.mock("@/models/automation", () => ({ AutomationModel: { findOne: mocks.automationFindOne } }));
vi.mock("@/models/automation-execution", () => ({ AutomationExecutionModel: { find: mocks.executionFind } }));

import { GET } from "@/app/api/automations/[automationId]/executions/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("GET /api/automations/:automationId/executions", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ automationId: "aut_1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when automation does not exist", async () => {
    mocks.automationFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ automationId: "aut_missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns executions list", async () => {
    mocks.automationFindOne.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "aut_1", userId: "user_1", projectId: null }) }) });
    const executions = [
      { executionId: "aexec_1", taskId: "task_1", source: "manual", status: "succeeded", createdAt: new Date() },
      { executionId: "aexec_2", taskId: "task_2", source: "schedule", status: "failed", createdAt: new Date() },
    ];
    mocks.executionFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(executions) }) }) }),
    });

    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ automationId: "aut_1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.executions).toHaveLength(2);
    expect(body.executions[0].executionId).toBe("aexec_1");
  });
});
