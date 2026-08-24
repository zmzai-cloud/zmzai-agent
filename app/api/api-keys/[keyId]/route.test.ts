import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  apiError: (code: string, status: number, message: string) => new Response(JSON.stringify({ code, message }), { status }),
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/models/agent-api-key", () => ({ AgentApiKeyModel: { updateOne: mocks.updateOne } }));

import { DELETE } from "@/app/api/api-keys/[keyId]/route";

const ctx = (keyId = "key_1") => ({ params: Promise.resolve({ keyId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.mockResolvedValue({ id: "user_1" });
});

describe("DELETE /api/api-keys/[keyId]", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await DELETE(new Request("http://localhost"), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when key is not found or already revoked", async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 0 });
    const res = await DELETE(new Request("http://localhost"), ctx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("API_KEY_NOT_FOUND");
  });

  it("revokes an active key", async () => {
    mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
    const res = await DELETE(new Request("http://localhost"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(true);
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { agentApiKeyId: "key_1", userId: "user_1", status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "revoked" }) }),
    );
  });
});
