import { expect, it } from "vitest";
import { RunModel } from "./run";

it("enforces one active Run per session across different Tasks", () => {
  expect(RunModel.schema.indexes()).toContainEqual([
    { sessionId: 1, active: 1 },
    { unique: true, partialFilterExpression: { active: true } },
  ]);
});
