import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  connectorFindOne: vi.fn(),
  connectorUpdateOne: vi.fn(),
  automationFindOne: vi.fn(),
  decryptConnectorHeaders: vi.fn(),
  launchAutomation: vi.fn(),
}));

vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
}));
vi.mock("@/lib/connector-secrets", () => ({ decryptConnectorHeaders: mocks.decryptConnectorHeaders }));
vi.mock("@/lib/automation-execution", () => ({ launchAutomation: mocks.launchAutomation }));
vi.mock("@/models/ipaas-connector", () => ({ IpaasConnectorModel: { findOne: mocks.connectorFindOne, updateOne: mocks.connectorUpdateOne } }));
vi.mock("@/models/automation", () => ({ AutomationModel: { findOne: mocks.automationFindOne } }));

import { POST } from "@/app/api/ipaas/webhook/inbound/[connectorId]/route";

const secret = "whsec_test_secret";

function connector(overrides: Record<string, unknown> = {}) {
  return {
    connectorId: "ipc_webhook_1",
    workspaceId: "ws_1",
    platform: "webhook",
    name: "Webhook 测试",
    status: "active",
    encryptedCredentials: "enc",
    linkedAutomationId: null,
    ...overrides,
  };
}

function post(body: string, headers: Record<string, string> = {}, connectorId = "ipc_webhook_1") {
  return POST(new NextRequest(`http://localhost/api/ipaas/webhook/inbound/${connectorId}`, { method: "POST", body, headers }), {
    params: Promise.resolve({ connectorId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorFindOne.mockReturnValue({
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(connector()) }),
  });
  mocks.connectorUpdateOne.mockResolvedValue({});
  mocks.decryptConnectorHeaders.mockReturnValue({ secret });
  mocks.launchAutomation.mockResolvedValue({ task: { taskId: "task_1" }, run: { runId: "run_1" } });
});

describe("POST /api/ipaas/webhook/inbound/[connectorId]", () => {
  it("resolves connectorId from the URL dynamic segment and returns 404 when the connector does not exist", async () => {
    // 回归：路由文件曾缺少 [connectorId] 动态段，回调 URL 中的 connectorId 永远解析不到。
    mocks.connectorFindOne.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    });
    const res = await post('{"event":"ping"}');
    expect(res.status).toBe(404);
    expect(mocks.connectorFindOne).toHaveBeenCalledWith({ connectorId: "ipc_webhook_1", platform: "webhook" });
  });

  it("rejects requests with an invalid signature", async () => {
    const res = await post('{"event":"ping"}', { "x-webhook-signature": "v1=deadbeef" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("IPAAS_WEBHOOK_INVALID");
  });

  it("accepts a signed request without a linked automation", async () => {
    const body = JSON.stringify({ event: "order.created", data: { id: 42 } });
    const signature = `v1=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const res = await post(body, { "x-webhook-signature": signature, "x-webhook-id": "wh_1", "x-webhook-event": "order.created" });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ received: true, message_id: "wh_1" });
    expect(mocks.launchAutomation).not.toHaveBeenCalled();
  });

  it("launches the linked automation with the event context", async () => {
    mocks.connectorFindOne.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(connector({ linkedAutomationId: "auto_1" })) }),
    });
    mocks.automationFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "auto_1", workspaceId: "ws_1", status: "active" }) });
    const body = JSON.stringify({ event: "deploy.completed", repo: "zmzai-agent" });
    const signature = `v1=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    const res = await post(body, { "x-webhook-signature": signature, "x-webhook-event": "deploy.completed" });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ received: true, task_id: "task_1", run_id: "run_1" });
    expect(mocks.launchAutomation).toHaveBeenCalledWith(expect.objectContaining({
      source: "webhook",
      contextText: expect.stringContaining("[Webhook 事件]"),
    }));
  });
});
