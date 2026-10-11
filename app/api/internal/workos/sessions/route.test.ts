import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  env: vi.fn(),
  listSessions: vi.fn(),

  workspaceFind: vi.fn(),
  runFind: vi.fn(),
}));
vi.mock("@/config/env", () => ({ getServerEnvironment: m.env }));
vi.mock("@/lib/database/mongodb", () => ({ connectMongo: vi.fn() }));
vi.mock("@/framework/core/session/mongo-models", () => ({ FrameworkSessionModel: { find: m.listSessions } }));
vi.mock("@/models/workspace", () => ({ WorkspaceModel: { find: m.workspaceFind } }));
vi.mock("@/models/run", () => ({ RunModel: { find: m.runFind } }));

const userId = "507f1f77bcf86cd799439011";

function req(query = "", secret: string | null = "secret") {
  return new NextRequest(`http://localhost/api/test?userId=${userId}${query}`, { headers: secret === null ? {} : { authorization: `Bearer ${secret}` } });
}
const lean = (value: unknown) => ({ sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue(value) });

beforeEach(() => {
  vi.resetAllMocks();
  m.env.mockReturnValue({ WORKOS_SERVICE_SECRET_CURRENT: "secret", WORKOS_SERVICE_SECRET_PREVIOUS: "previous" });
  m.listSessions.mockReturnValue(lean([
    { sessionId: "ses_new", userId, workspaceId: "ws_1", title: "新对话", time: { created: 2, updated: "2026-10-11T00:00:00.000Z" } },
    { sessionId: "ses_old", userId, workspaceId: "ws_1", title: "旧对话", time: { created: 1, updated: "2026-10-10T00:00:00.000Z" } },
  ]));
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
  expect(m.listSessions).toHaveBeenCalledWith({ userId, workspaceId: { $in: ["ws_1"] } });
});

it("filters by owned workspaces at the database boundary", async () => {
  m.workspaceFind.mockReturnValue(lean([]));
  m.listSessions.mockReturnValue(lean([]));
  const body = await (await GET(req())).json();
  expect(body.items).toHaveLength(0);
  expect(m.listSessions).toHaveBeenCalledWith({ userId, workspaceId: { $in: [] } });
});
it("paginates stable exports and searches titles before limiting", async () => {
  const response = await GET(req("&order=stable&limit=1&after=ses_before&q=a.b"));
  const body = await response.json();
  expect(body.nextCursor).toBe("ses_new");
  expect(m.listSessions).toHaveBeenCalledWith(expect.objectContaining({ sessionId: { $gt: "ses_before" }, title: { $regex: "a\\.b", $options: "i" } }));
});
it("rejects cursor misuse", async () => {
  expect((await GET(req("&after=ses_before"))).status).toBe(400);
});
