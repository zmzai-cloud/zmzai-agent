import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ createIndex: vi.fn(), listIndexes: vi.fn(), toArray: vi.fn() }));
vi.mock("@/models/run", () => ({ RunModel: { collection: { createIndex: m.createIndex, listIndexes: m.listIndexes } } }));

import { ensureActiveSessionRunIndex } from "./active-session-run-index";

beforeEach(() => {
  vi.resetAllMocks();
  m.createIndex.mockResolvedValue("sessionId_1_active_1");
  m.listIndexes.mockReturnValue({ toArray: m.toArray });
  m.toArray.mockResolvedValue([{ key: { sessionId: 1, active: 1 }, unique: true, partialFilterExpression: { active: true } }]);
});

it("creates and verifies the active-session index before accepting traffic", async () => {
  expect(await ensureActiveSessionRunIndex()).toBe(true);
  expect(m.createIndex).toHaveBeenCalledWith({ sessionId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
  expect(m.listIndexes).toHaveBeenCalledTimes(1);
});

it("fails closed when duplicate active Runs prevent index creation", async () => {
  m.createIndex.mockRejectedValue(Object.assign(new Error("duplicate active session"), { code: 11000 }));
  expect(await ensureActiveSessionRunIndex()).toBe(false);
  expect(m.listIndexes).not.toHaveBeenCalled();
});

it("fails closed when the installed index does not have the required uniqueness", async () => {
  m.toArray.mockResolvedValue([{ key: { sessionId: 1, active: 1 }, unique: false }]);
  expect(await ensureActiveSessionRunIndex()).toBe(false);
});
