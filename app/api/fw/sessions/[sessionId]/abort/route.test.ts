import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getSession: vi.fn(),
  cancelRunForSession: vi.fn(),
  getFrameworkRunner: vi.fn(),
  getSessionProjectAccess: vi.fn(),
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
  cancelRunForSession: mocks.cancelRunForSession,
}));
vi.mock("@/lib/project-access", () => ({
  getSessionProjectAccess: mocks.getSessionProjectAccess,
  canRunProject: mocks.canRunProject,
}));

import { POST } from "@/app/api/fw/sessions/[sessionId]/abort/route";

const ctx = (sessionId = "sess_1") => ({ params: Promise.resolve({ sessionId }) });
const abortFn = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
  mocks.cancelRunForSession.mockResolvedValue({ runId: "run_1", status: "cancelled" });
  mocks.getFrameworkRunner.mockReturnValue({ abort: abortFn });
  abortFn.mockResolvedValue(undefined);
});

describe("POST /api/fw/sessions/.../abort", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when session does not exist", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("aborts a session owned by the user", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_1" });
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aborted).toBe(true);
    expect(body.run.runId).toBe("run_1");
    expect(abortFn).toHaveBeenCalledWith("sess_1");
  });

  it("returns 404 when non-owner has no project access", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_2" });
    mocks.getSessionProjectAccess.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
  });

  it("allows non-owner with project access to abort", async () => {
    mocks.getSession.mockResolvedValue({ sessionId: "sess_1", userId: "user_2" });
    mocks.getSessionProjectAccess.mockResolvedValue({ role: "editor" });
    mocks.canRunProject.mockReturnValue(true);
    const res = await POST(new Request("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aborted).toBe(true);
  });
});
