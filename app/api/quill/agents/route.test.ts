import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getFrameworkRegistry: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));
vi.mock("@/framework/server/context", () => ({
  getFrameworkRegistry: mocks.getFrameworkRegistry,
}));

import { GET } from "@/app/api/quill/agents/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/quill/agents", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns registered agents", async () => {
    mocks.currentUser.mockResolvedValue({ id: "user_1" });
    mocks.getFrameworkRegistry.mockReturnValue({
      list: () => [
        { name: "default", description: "Default agent", mode: "auto" },
        { name: "researcher", description: "Research agent", mode: "ask" },
      ],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(2);
    expect(body.agents[0].name).toBe("default");
    expect(body.agents[1].mode).toBe("ask");
  });

  it("returns empty array when no agents registered", async () => {
    mocks.currentUser.mockResolvedValue({ id: "user_1" });
    mocks.getFrameworkRegistry.mockReturnValue({ list: () => [] });
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });
});
