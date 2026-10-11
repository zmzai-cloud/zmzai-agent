import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  env: vi.fn(),
  ownedSession: vi.fn(),
  runFindOne: vi.fn(),
  taskFindOne: vi.fn(),
  approvalFindOne: vi.fn(),
  replyPermission: vi.fn(),
  projectReply: vi.fn(),
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: m.env }));
vi.mock("@/lib/database/mongodb", () => ({ connectMongo: vi.fn() }));
vi.mock("@/lib/workos-session-access", () => ({ getOwnedWorkosSession: m.ownedSession }));
vi.mock("@/models/run", () => ({ RunModel: { findOne: m.runFindOne } }));
vi.mock("@/models/task", () => ({ TaskModel: { findOne: m.taskFindOne } }));
vi.mock("@/models/approval", () => ({ ApprovalRequestModel: { findOne: m.approvalFindOne } }));
vi.mock("@/framework/server/context", () => ({ getFrameworkRunner: () => ({ replyPermission: m.replyPermission }) }));
vi.mock("@/lib/approval-projection", () => ({ projectApprovalReply: m.projectReply }));

const userId = "507f1f77bcf86cd799439011";
const run = { runId: "run_1", sessionId: "ses_1", taskId: "task_1", userId, status: "running", active: true };

function req(body: unknown, secret: string | null = "secret") {
  return new NextRequest(`http://localhost/api/test/ses_1/permissions/req_1`, { method: "POST", body: JSON.stringify(body), headers: secret === null ? {} : { authorization: `Bearer ${secret}` } });
}
const lean = (value: unknown) => ({ lean: vi.fn().mockResolvedValue(value), sort: vi.fn().mockReturnThis() });

const params = { params: Promise.resolve({ sessionId: "ses_1", requestId: "req_1" }) };

beforeEach(() => {
  vi.resetAllMocks();
  m.env.mockReturnValue({ WORKOS_SERVICE_SECRET_CURRENT: "secret", WORKOS_SERVICE_SECRET_PREVIOUS: "previous" });
  m.ownedSession.mockResolvedValue({ id: "ses_1", userId, workspaceId: "ws_1" });
  m.runFindOne.mockReturnValue(lean(run));
  m.taskFindOne.mockReturnValue(lean({ taskId: "task_1", userId, workspaceId: "ws_1" }));
  m.approvalFindOne.mockReturnValue(lean({ requestId: "req_1", taskId: "task_1", runId: "run_1", status: "pending" }));
  m.replyPermission.mockResolvedValue(true);
  m.projectReply.mockResolvedValue(undefined);
});

import { POST } from "./route";

it.each([null, "bad"])("rejects invalid secret %s", async (secret) => {
  expect((await POST(req({ userId, reply: "once" }, secret), params)).status).toBe(401);
  expect(m.replyPermission).not.toHaveBeenCalled();
});

it("returns 404 when the session is not owned by the caller's user", async () => {
  m.ownedSession.mockResolvedValue(null);
  expect((await POST(req({ userId, reply: "once" }), params)).status).toBe(404);
});

it("rejects a spoofed or invalid userId", async () => {
  expect((await POST(req({ userId: "attacker", reply: "once" }), params)).status).toBe(400);
});

it("replies through the framework runner and records the audit projection", async () => {
  const response = await POST(req({ userId, reply: "once", feedback: "可以" }), params);
  expect(response.status).toBe(200);
  expect(m.replyPermission).toHaveBeenCalledWith("ses_1", "req_1", "once", "可以");
  expect(m.projectReply).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "ses_1", requestId: "req_1", reply: "once", decidedBy: userId }));
});

it("returns 404 when the approval is already resolved", async () => {
  m.replyPermission.mockResolvedValue(false);
  expect((await POST(req({ userId, reply: "once" }), params)).status).toBe(404);
});

it("returns 404 when no pending approval row exists", async () => {
  m.approvalFindOne.mockReturnValue(lean(null));
  expect((await POST(req({ userId, reply: "once" }), params)).status).toBe(404);
  expect(m.replyPermission).not.toHaveBeenCalled();
});
