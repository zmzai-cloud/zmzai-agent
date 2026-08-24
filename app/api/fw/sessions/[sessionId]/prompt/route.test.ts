import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getSession: vi.fn(),
  findOne: vi.fn(),
  ensureRunForPrompt: vi.fn(),
  getFrameworkRunner: vi.fn(),
  getProjectAccess: vi.fn(),
  canRunProject: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/framework/core/runtime/runner", () => ({
  defaultStore: { getSession: mocks.getSession },
}));
vi.mock("@/framework/server/context", () => ({
  getFrameworkRunner: mocks.getFrameworkRunner,
}));
vi.mock("@/lib/task-run-control", () => ({
  ensureRunForPrompt: mocks.ensureRunForPrompt,
}));
vi.mock("@/models/run", () => ({ RunModel: { findOne: mocks.findOne } }));
vi.mock("@/models/task", () => ({ TaskModel: { findOne: mocks.findOne } }));
vi.mock("@/lib/project-access", () => ({
  getProjectAccess: mocks.getProjectAccess,
  canRunProject: mocks.canRunProject,
}));

import { POST } from "@/app/api/fw/sessions/[sessionId]/prompt/route";

const ctx = (sessionId = "sess_1") => ({
  params: Promise.resolve({ sessionId }),
});

const promptBody = (overrides?: Record<string, unknown>) =>
  JSON.stringify({ text: "Hello agent", ...overrides });

const promptReq = (sessionId = "sess_1", body = promptBody()) =>
  new Request(`http://localhost/api/fw/sessions/${sessionId}/prompt`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });

const promptRunner = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.findOne.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
  mocks.ensureRunForPrompt.mockResolvedValue({ task: { taskId: "task_1" }, run: { runId: "run_1" } });
  promptRunner.mockResolvedValue({ queued: true });
  mocks.getFrameworkRunner.mockReturnValue({ prompt: promptRunner });
});

describe("POST /api/fw/sessions/.../prompt", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(promptReq() as any, ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when session does not exist", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(promptReq() as any, ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns 400 for invalid prompt body", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_1" });
    const res = await POST(promptReq("sess_1", promptBody({ text: "" })) as any, ctx());
    expect(res.status).toBe(400);
  });

  it("submits a prompt successfully for session owner", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_1" });
    const res = await POST(promptReq() as any, ctx());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.queued).toBe(true);
    expect(body.task.taskId).toBe("task_1");
    expect(promptRunner).toHaveBeenCalledWith("sess_1", expect.objectContaining({ text: "Hello agent" }));
  });

  it("passes agent and images when provided", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_1" });
    const images = [{ url: "data:image/png;base64,abc", mediaType: "image/png" }];
    const res = await POST(promptReq("sess_1", promptBody({ agent: "researcher", images })) as any, ctx());
    expect(res.status).toBe(202);
    expect(promptRunner).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      text: "Hello agent",
      agent: "researcher",
      images,
    }));
  });

  it("returns 404 when non-owner has no project access", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_2" });
    // findOne is shared between RunModel and TaskModel — first call is RunModel
    const runData = { runId: "run_1", taskId: "task_1", sessionId: "sess_1" };
    const taskData = { taskId: "task_1", projectId: "proj_1" };
    mocks.findOne
      .mockReturnValueOnce({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(runData) }) }) // RunModel.findOne
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(taskData) }); // TaskModel.findOne
    mocks.getProjectAccess.mockResolvedValue(null);

    const res = await POST(promptReq() as any, ctx());
    expect(res.status).toBe(404);
  });

  it("allows non-owner with project access to submit prompt", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_2" });
    const runData = { runId: "run_1", taskId: "task_1", sessionId: "sess_1" };
    const taskData = { taskId: "task_1", projectId: "proj_1" };
    mocks.findOne
      .mockReturnValueOnce({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(runData) }) })
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(taskData) });
    mocks.getProjectAccess.mockResolvedValue({ role: "editor" });
    mocks.canRunProject.mockReturnValue(true);

    const res = await POST(promptReq() as any, ctx());
    expect(res.status).toBe(202);
  });

  it("forces a new run when active run is paused", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_1" });
    // First findOne call in the route: active run lookup
    mocks.findOne.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          runId: "run_active",
          sessionId: "sess_1",
          active: true,
          status: "paused",
          latestCheckpointId: "cp_1",
        }),
      }),
    });

    await POST(promptReq() as any, ctx());
    expect(mocks.ensureRunForPrompt).toHaveBeenCalledWith(
      expect.anything(),
      "Hello agent",
      expect.objectContaining({ forceNewRun: true, parentRunId: "run_active", resumeCheckpointId: "cp_1" }),
    );
  });
});
