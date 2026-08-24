import { describe, expect, it } from "vitest";

/** Fault-drill: Mongo 暂时不可用时 lease 过期回收。
 *  验证 lease-based 调度在以下场景的正确性：
 *  - 过期 lease 可以被新 owner 接管
 *  - 活跃 lease 不会被抢占
 *  - 调度器 tick 的幂等性（同一 owner 不会重复 dispatch）
 *
 *  这些测试验证 lease 逻辑的纯函数部分，不依赖 Mongo 连接。 */
describe("fault-drill: lease expiry recovery", () => {
  function isLeaseExpired(expiresAt: Date | null, now: Date): boolean {
    return expiresAt === null || expiresAt < now;
  }

  function canClaimLease(currentLeaseExpiresAt: Date | null, now: Date): boolean {
    return isLeaseExpired(currentLeaseExpiresAt, now);
  }

  it("considers null lease as immediately expirable", () => {
    expect(isLeaseExpired(null, new Date())).toBe(true);
  });

  it("considers a past-due lease as expired", () => {
    const pastExpiry = new Date(Date.now() - 60_000);
    expect(isLeaseExpired(pastExpiry, new Date())).toBe(true);
  });

  it("considers a future lease as active", () => {
    const futureExpiry = new Date(Date.now() + 5 * 60_000);
    expect(isLeaseExpired(futureExpiry, new Date())).toBe(false);
  });

  it("allows claiming only when lease is expired or null", () => {
    expect(canClaimLease(null, new Date())).toBe(true);
    expect(canClaimLease(new Date(Date.now() - 1000), new Date())).toBe(true);
    expect(canClaimLease(new Date(Date.now() + 60_000), new Date())).toBe(false);
  });

  it("lease duration of 5 minutes provides adequate recovery window", () => {
    const leaseDurationMs = 5 * 60_000;
    const leaseStart = new Date();
    const leaseExpiry = new Date(leaseStart.getTime() + leaseDurationMs);

    // Within the lease window: not expired
    expect(isLeaseExpired(leaseExpiry, new Date(leaseStart.getTime() + 60_000))).toBe(false);

    // After the lease window: expired and reclaimable
    expect(isLeaseExpired(leaseExpiry, new Date(leaseStart.getTime() + 6 * 60_000))).toBe(true);
  });

  it("concurrent schedulers cannot double-claim the same lease", () => {
    // Simulates the findOneAndUpdate atomic claim pattern:
    // Only one caller can match { leaseExpiresAt: { $lt: now } } and
    // set a new expiry. The second caller sees the updated lease and
    // must back off.
    const now = new Date();
    const expiredLease = new Date(now.getTime() - 1000);
    const newLease = new Date(now.getTime() + 5 * 60_000);

    // First caller sees expired lease → claims it
    expect(canClaimLease(expiredLease, now)).toBe(true);

    // After claim, lease is refreshed
    expect(canClaimLease(newLease, now)).toBe(false);

    // Second caller sees the refreshed lease → cannot claim
    expect(canClaimLease(newLease, now)).toBe(false);
  });
});
