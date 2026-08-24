import { describe, expect, it } from "vitest";

import { isRetryableRelayStatus } from "@/lib/relay-agent-stream";

/** Fault-drill: Relay 余额不足/授权失败时不重试，直接映射为终态错误。
 *  验证 relay 错误分类不会把不可重试的错误（402 余额不足、401 授权失败）
 *  当成瞬态故障重试，避免无限循环消耗额度。 */
describe("fault-drill: relay balance error mapping", () => {
  it("does not retry authorization failures (401)", () => {
    expect(isRetryableRelayStatus(401)).toBe(false);
  });

  it("does not retry payment required / balance insufficient (402)", () => {
    expect(isRetryableRelayStatus(402)).toBe(false);
  });

  it("does not retry forbidden access (403)", () => {
    expect(isRetryableRelayStatus(403)).toBe(false);
  });

  it("does not retry rate limiting (429)", () => {
    expect(isRetryableRelayStatus(429)).toBe(false);
  });

  it("retries server errors that indicate transient infrastructure issues", () => {
    expect(isRetryableRelayStatus(500)).toBe(true);
    expect(isRetryableRelayStatus(502)).toBe(true);
    expect(isRetryableRelayStatus(503)).toBe(true);
    expect(isRetryableRelayStatus(504)).toBe(true);
  });

  it("does not retry client errors in the 4xx range (except unknown)", () => {
    for (let status = 400; status < 500; status++) {
      if (status === 408 || status === 429) continue; // timeout and rate-limit have their own handling
      expect(isRetryableRelayStatus(status)).toBe(false);
    }
  });
});
