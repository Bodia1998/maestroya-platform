import { describe, expect, it } from "vitest";

import { estimateResourceUsage } from "@/infrastructure/performance/metrics-collector";

describe("infrastructure/performance/metrics-collector — estimateResourceUsage", () => {
  it("scales cpuPercent/dbPoolUtilization with virtualUsers", () => {
    const low = estimateResourceUsage({ category: "AUTHENTICATION", virtualUsers: 10, errorRate: 0 });
    const high = estimateResourceUsage({ category: "AUTHENTICATION", virtualUsers: 1000, errorRate: 0 });
    expect(high.cpuPercent).toBeGreaterThan(low.cpuPercent);
    expect(high.dbConnectionPoolUtilizationPercent).toBeGreaterThanOrEqual(low.dbConnectionPoolUtilizationPercent);
  });

  it("caps cpuPercent and dbConnectionPoolUtilizationPercent at 100", () => {
    const estimate = estimateResourceUsage({ category: "DATABASE_INTENSIVE", virtualUsers: 100_000, errorRate: 0 });
    expect(estimate.cpuPercent).toBe(100);
    expect(estimate.dbConnectionPoolUtilizationPercent).toBe(100);
  });

  it("degrades cacheHitRatioPercent as errorRate rises, floored at 0", () => {
    const healthy = estimateResourceUsage({ category: "BROWSE_PROFESSIONALS", virtualUsers: 100, errorRate: 0 });
    const struggling = estimateResourceUsage({ category: "BROWSE_PROFESSIONALS", virtualUsers: 100, errorRate: 0.5 });
    const totalFailure = estimateResourceUsage({ category: "BROWSE_PROFESSIONALS", virtualUsers: 100, errorRate: 1 });
    expect(struggling.cacheHitRatioPercent).toBeLessThan(healthy.cacheHitRatioPercent);
    expect(totalFailure.cacheHitRatioPercent).toBe(0);
  });

  it("gives a write-heavy category (DATABASE_INTENSIVE) a lower baseline cache-hit ratio than a read-heavy one (BROWSE_PROFESSIONALS)", () => {
    const dbIntensive = estimateResourceUsage({ category: "DATABASE_INTENSIVE", virtualUsers: 10, errorRate: 0 });
    const browsing = estimateResourceUsage({ category: "BROWSE_PROFESSIONALS", virtualUsers: 10, errorRate: 0 });
    expect(dbIntensive.cacheHitRatioPercent).toBeLessThan(browsing.cacheHitRatioPercent);
  });

  it("returns a positive baseline memoryMB even at zero virtual users", () => {
    const estimate = estimateResourceUsage({ category: "AUTHENTICATION", virtualUsers: 0, errorRate: 0 });
    expect(estimate.memoryMB).toBeGreaterThan(0);
  });
});
