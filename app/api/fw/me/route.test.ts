import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/api-error", () => ({
  unauthenticated: () => new Response(JSON.stringify({ code: "UNAUTHENTICATED" }), { status: 401 }),
}));

import { GET } from "@/app/api/fw/me/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/fw/me", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.currentUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns current user info", async () => {
    mocks.currentUser.mockResolvedValue({ id: "user_1", name: "Test User", email: "test@example.com" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ name: "Test User", email: "test@example.com" });
  });
});
