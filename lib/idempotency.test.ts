import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestHash, claimIdempotency, IdempotencyError } from "@/lib/idempotency";

const idempotencyModel = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/models/idempotency", () => ({ IdempotencyModel: idempotencyModel }));

function mockFindOneLean(result: unknown) {
  idempotencyModel.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(result) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- requestHash ----

describe("requestHash", () => {
  it("produces deterministic SHA-256 hex for the same input", () => {
    const a = requestHash({ foo: "bar", n: 42 });
    const b = requestHash({ foo: "bar", n: 42 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    const a = requestHash({ x: 1 });
    const b = requestHash({ x: 2 });
    expect(a).not.toBe(b);
  });

  it("handles null and undefined", () => {
    const h = requestHash(null);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---- IdempotencyError ----

describe("IdempotencyError", () => {
  it("has correct name and code", () => {
    const err = new IdempotencyError("IDEMPOTENCY_CONFLICT");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IdempotencyError");
    expect(err.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(err.message).toBe("IDEMPOTENCY_CONFLICT");
  });
});

// ---- claimIdempotency ----

describe("claimIdempotency", () => {
  const baseInput = { userId: "u1", scope: "tasks", key: "idem_abcdefghijklmnop", body: { text: "hello" }, resourceId: "res_1" };

  it("throws IDEMPOTENCY_KEY_REQUIRED when key is null", async () => {
    try {
      await claimIdempotency({ ...baseInput, key: null });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IdempotencyError);
      expect((err as IdempotencyError).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("throws IDEMPOTENCY_KEY_REQUIRED when key is too short", async () => {
    try {
      await claimIdempotency({ ...baseInput, key: "short" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as IdempotencyError).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("throws IDEMPOTENCY_KEY_REQUIRED when key has invalid characters", async () => {
    try {
      await claimIdempotency({ ...baseInput, key: "has spaces and tabs\t" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as IdempotencyError).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("creates a new record and returns replayed=false", async () => {
    mockFindOneLean(null);
    idempotencyModel.create.mockResolvedValue({});
    const result = await claimIdempotency(baseInput);
    expect(result).toEqual({ resourceId: "res_1", replayed: false });
    expect(idempotencyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", scope: "tasks", key: "idem_abcdefghijklmnop", resourceId: "res_1",
    }));
  });

  it("returns replayed=true when existing record has matching hash", async () => {
    const hash = requestHash(baseInput.body);
    mockFindOneLean({ resourceId: "res_original", requestHash: hash });
    const result = await claimIdempotency(baseInput);
    expect(result).toEqual({ resourceId: "res_original", replayed: true });
    expect(idempotencyModel.create).not.toHaveBeenCalled();
  });

  it("throws IDEMPOTENCY_CONFLICT when existing record has different hash", async () => {
    mockFindOneLean({ resourceId: "res_other", requestHash: "different_hash" });
    try {
      await claimIdempotency(baseInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as IdempotencyError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("handles duplicate key race condition — replay if hash matches", async () => {
    idempotencyModel.findOne
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ resourceId: "res_raced", requestHash: requestHash(baseInput.body) }) });
    idempotencyModel.create.mockRejectedValue(new Error("duplicate key error"));

    const result = await claimIdempotency(baseInput);
    expect(result).toEqual({ resourceId: "res_raced", replayed: true });
  });

  it("handles duplicate key race condition — conflict if hash differs", async () => {
    idempotencyModel.findOne
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue({ resourceId: "res_raced", requestHash: "different_hash" }) });
    idempotencyModel.create.mockRejectedValue(new Error("duplicate key error"));

    try {
      await claimIdempotency(baseInput);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as IdempotencyError).code).toBe("IDEMPOTENCY_CONFLICT");
    }
  });

  it("rethrows non-duplicate-key errors from create", async () => {
    mockFindOneLean(null);
    idempotencyModel.create.mockRejectedValue(new Error("connection refused"));
    await expect(claimIdempotency(baseInput)).rejects.toThrow("connection refused");
  });
});
