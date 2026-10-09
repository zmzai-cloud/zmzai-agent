import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  env: vi.fn(),
  listSessions: vi.fn(),
  ownedSession: vi.fn(),
  workspaceFind: vi.fn(),
  runFind: vi.fn(),
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: m.env }));
vi.mock("@/lib/database/mongodb", () => ({ connectMongo: vi.fn() }));
vi.mock("@/framework/core/runtime/runner", () => ({ defaultStore: { listSessions: m.listSessions } }));
vi.mock("@/lib/workos-session-access", () => ({ getOwnedWorkosSession: m.ownedSession }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { find: m.workspaceFind } }));
vi.mock("@/models/run", () => ({ RunModel: { find: m.runFind } }));

const userId = "507f1f77bcf86cd799439011";

function req(query = "", secret: string | null = "secret") {
  return new NextRequest(`http://localhost/api/test?userId=${userId}${query}`, { headers: secret === null ? {} : { authorization: `Bearer ${secret}` } });
}
const lean = (value: unknown) => ({ select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue(value) });

beforeEach(() => {
  vi.resetAllMocks();
  m.env.mockReturnValue({ WORKOS_SERVICE_SECRET_CURRENT: "secret", WORKOS_SERVICE_SECRET_PREVIOUS: "previous" });
  m.ownedSession.mockImplementation(async (sessionId: string) => ({ id: sessionId, userId, workspaceId: "ws_1" }));
  m.listSessions.mockResolvedValue([
    { id: "ses_new", userId, workspaceId: "ws_1", title: "新对话", time: { created: 2, updated: 2 } },
    { id: "ses_old", userId, workspaceId: "ws_1", title: "旧对话", time: { created: 1, updated: 1 } },
  ]);
  m.workspaceFind.mockReturnValue(lean([{ workspaceId: "ws_1", name: "默认空间" }]));
  m.runFind.mockReturnValue(lean([
    { runId: "run_a", sessionId: "ses_old", status: "succeeded", active: false, createdAt: new Date(1) },
    { runId: "run_b", sessionId: "ses_new", status: "running", active: true, createdAt: new Date(2) },
  ]));
});

import { GET } from "./route";

it.each([null, "bad"])("rejects invalid secret %s", async (secret) => {
  expect((await GET(req("", secret))).status).toBe(401);
  expect(m.listSessions).not.toHaveBeenCalled();
});

it("rejects a non-ObjectId userId", async () => {
  const request = new NextRequest("http://localhost/api/test?userId=attacker", { headers: { authorization: "Bearer secret" } });
  expect((await GET(request)).status).toBe(400);
});

it("rejects an invalid limit", async () => {
  expect((await GET(req("&limit=0"))).status).toBe(400);
  expect((await GET(req("&limit=-2"))).status).toBe(400);
});

it("lists recent sessions newest-first with latest run status and workspace name", async () => {
  const response = await GET(req("&limit=2"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.items).toEqual([
    { sessionId: "ses_new", title: "新对话", workspaceId: "ws_1", workspaceName: "默认空间", updatedAt: expect.any(String), latestRun: { runId: "run_b", status: "running", active: true } },
    { sessionId: "ses_old", title: "旧对话", workspaceId: "ws_1", workspaceName: "默认空间", updatedAt: expect.any(String), latestRun: { runId: "run_a", status: "succeeded", active: false } },
  ]);
  expect(m.listSessions).toHaveBeenCalledWith({ userId });
});

it("skips sessions the user does not own", async () => {
  m.ownedSession.mockImplementation(async (sessionId: string) => (sessionId === "ses_new" ? { id: sessionId, userId } : null));
  const response = await GET(req(""));
  const body = await response.json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].sessionId).toBe("ses_new");
});
