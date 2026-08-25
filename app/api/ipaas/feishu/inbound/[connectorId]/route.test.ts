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

import { POST } from "@/app/api/ipaas/feishu/inbound/[connectorId]/route";

function connector(overrides: Record<string, unknown> = {}) {
  return {
    connectorId: "ipc_feishu_1",
    workspaceId: "ws_1",
    platform: "feishu",
    name: "飞书测试",
    status: "active",
    encryptedCredentials: "enc",
    linkedAutomationId: null,
    ...overrides,
  };
}

function feishuEvent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    token: "verify_token_123",
    type: "event_callback",
    event: {
      sender: { sender_id: { open_id: "ou_123" } },
      message: { message_id: "om_123", chat_id: "oc_123", chat_type: "p2p", content: '{"text":"你好"}' },
    },
    ...overrides,
  });
}

function post(body: string, connectorId = "ipc_feishu_1") {
  return POST(new NextRequest(`http://localhost/api/ipaas/feishu/inbound/${connectorId}`, { method: "POST", body }), {
    params: Promise.resolve({ connectorId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectorFindOne.mockReturnValue({
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(connector()) }),
  });
  mocks.connectorUpdateOne.mockResolvedValue({});
  mocks.decryptConnectorHeaders.mockReturnValue({ verificationToken: "verify_token_123" });
  mocks.launchAutomation.mockResolvedValue({ task: { taskId: "task_1" }, run: { runId: "run_1" } });
});

describe("POST /api/ipaas/feishu/inbound/[connectorId]", () => {
  it("resolves connectorId from the URL dynamic segment and returns 404 when the connector does not exist", async () => {
    // 回归：路由文件曾缺少 [connectorId] 动态段，connectorId 永远解析不到，
    // findOne 恒为空导致回调 URL 形同虚设。
    mocks.connectorFindOne.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    });
    const res = await post(feishuEvent());
    expect(res.status).toBe(404);
    expect(mocks.connectorFindOne).toHaveBeenCalledWith({ connectorId: "ipc_feishu_1", platform: "feishu" });
  });

  it("answers the Feishu url_verification challenge", async () => {
    const res = await post(JSON.stringify({ token: "verify_token_123", type: "url_verification", challenge: "challenge_abc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "challenge_abc" });
  });

  it("rejects events with a mismatched verification token", async () => {
    const res = await post(feishuEvent({ token: "wrong_token" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("IPAAS_FEISHU_INVALID");
  });

  it("accepts a message event without a linked automation", async () => {
    const res = await post(feishuEvent());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ received: true, message_id: "om_123" });
    expect(mocks.launchAutomation).not.toHaveBeenCalled();
  });

  it("launches the linked automation and returns its ids", async () => {
    mocks.connectorFindOne.mockReturnValue({
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(connector({ linkedAutomationId: "auto_1" })) }),
    });
    mocks.automationFindOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ automationId: "auto_1", workspaceId: "ws_1", status: "active" }) });
    const res = await post(feishuEvent());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ received: true, task_id: "task_1", run_id: "run_1" });
    expect(mocks.launchAutomation).toHaveBeenCalledWith(expect.objectContaining({ source: "webhook", contextText: expect.stringContaining("[飞书消息]") }));
  });

  it("rejects bodies over the 64 KiB limit", async () => {
    const res = await post(JSON.stringify({ token: "verify_token_123", type: "url_verification", challenge: "c", pad: "x".repeat(70 * 1024) }));
    expect(res.status).toBe(413);
  });
});
