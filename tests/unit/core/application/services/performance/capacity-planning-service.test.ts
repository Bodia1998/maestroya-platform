import { describe, expect, it } from "vitest";

import { CapacityPlanningService } from "@/application/services/performance/capacity-planning-service";
import { CAPACITY_USER_TIERS } from "@/domain/entities/capacity-report";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceScenario, WorkloadProfile } from "@/domain/entities/performance-scenario";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function completedResult(overrides: { cpuPercent?: number; dbPool?: number; memoryMB?: number; p95?: number; rps?: number } = {}): LoadTestResult {
  const result = LoadTestResult.schedule("r1", "database-intensive", null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.rehydrate({ sampleCount: 10, min: 1, max: 500, average: 100, median: 90, p95: overrides.p95 ?? 300, p99: 400 }),
      throughput: { requestsPerSecond: overrides.rps ?? 50, transactionsPerSecond: 48 },
      resourceEstimate: {
        cpuPercent: overrides.cpuPercent ?? 10,
        memoryMB: overrides.memoryMB ?? 256,
        dbConnectionPoolUtilizationPercent: overrides.dbPool ?? 10,
        cacheHitRatioPercent: 20,
      },
      totalRequests: 100,
      failedRequests: 1,
      timedOutRequests: 0,
      retriedRequests: 0,
    },
    t0,
  );
  return result;
}

function makeScenario(virtualUsers = 100, category: PerformanceScenario["category"] = "DATABASE_INTENSIVE"): PerformanceScenario {
  return PerformanceScenario.define({
    id: "database-intensive",
    name: "Database Intensive",
    category,
    description: "test",
    workloadProfile: new WorkloadProfile(virtualUsers, 60, 10),
  });
}

describe("application/services/performance/capacity-planning-service — projectForScenario", () => {
  it("produces one projection per tier, scaling linearly at ratio 1", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100);
    const result = completedResult({ rps: 50, cpuPercent: 10 });
    const projections = service.projectForScenario(scenario, result);

    expect(projections).toHaveLength(CAPACITY_USER_TIERS.length);
    const tier100 = projections.find((p) => p.userTier === 100)!;
    expect(tier100.projectedRequestsPerSecond).toBeCloseTo(50, 5);
    expect(tier100.projectedCpuPercent).toBeCloseTo(10, 5);
  });

  it("scales requestsPerSecond sub-linearly (diminishing returns) with the concurrency ratio", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100);
    const result = completedResult({ rps: 50 });
    const projections = service.projectForScenario(scenario, result);

    const tier1000 = projections.find((p) => p.userTier === 1000)!;
    // ratio = 1000/100 = 10; 50 * 10^0.85 ≈ 353.97 — well below the 500
    // a pure linear projection would give, the diminishing-returns
    // property this test exists to pin down.
    expect(tier1000.projectedRequestsPerSecond).toBeCloseTo(353.9728921920689, 5);
    expect(tier1000.projectedRequestsPerSecond).toBeLessThan(500);

    // Still monotonically increasing with tier, just not linearly.
    const tier500 = projections.find((p) => p.userTier === 500)!;
    expect(tier1000.projectedRequestsPerSecond).toBeGreaterThan(tier500.projectedRequestsPerSecond);
  });

  it("caps projected CPU and DB pool utilization at 100", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100);
    const result = completedResult({ cpuPercent: 50, dbPool: 50 });
    const projections = service.projectForScenario(scenario, result);

    const tier100000 = projections.find((p) => p.userTier === 100_000)!;
    expect(tier100000.projectedCpuPercent).toBe(100);
    expect(tier100000.projectedDbConnectionPoolUtilizationPercent).toBe(100);
  });

  it("throws for a non-COMPLETED result", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100);
    const pending = LoadTestResult.schedule("r2", "database-intensive", null, t0);
    expect(() => service.projectForScenario(scenario, pending)).toThrow();
  });
});

describe("application/services/performance/capacity-planning-service — recommendationsFor", () => {
  it("returns no recommendations when no tier crosses any threshold", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100, "AUTHENTICATION");
    const result = completedResult({ cpuPercent: 0.01, dbPool: 0.01, memoryMB: 1 });
    const projections = service.projectForScenario(scenario, result);
    const recommendations = service.recommendationsFor(scenario, projections);
    expect(recommendations).toHaveLength(0);
  });

  it("recommends HORIZONTAL_INSTANCES when projected CPU saturates", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100, "AUTHENTICATION");
    const result = completedResult({ cpuPercent: 50 }); // scales past 80% quickly
    const projections = service.projectForScenario(scenario, result);
    const recommendations = service.recommendationsFor(scenario, projections);
    expect(recommendations.some((r) => r.category === "HORIZONTAL_INSTANCES")).toBe(true);
  });

  it("recommends DATABASE_SCALING (not READ_REPLICAS) for a DATABASE_INTENSIVE scenario saturating the DB pool", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100, "DATABASE_INTENSIVE");
    const result = completedResult({ dbPool: 50 });
    const projections = service.projectForScenario(scenario, result);
    const recommendations = service.recommendationsFor(scenario, projections);
    expect(recommendations.some((r) => r.category === "DATABASE_SCALING")).toBe(true);
    expect(recommendations.some((r) => r.category === "READ_REPLICAS")).toBe(false);
  });

  it("recommends READ_REPLICAS (not DATABASE_SCALING) for a non-DATABASE_INTENSIVE scenario saturating the DB pool", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100, "BOOKING");
    const result = completedResult({ dbPool: 50 });
    const projections = service.projectForScenario(scenario, result);
    const recommendations = service.recommendationsFor(scenario, projections);
    expect(recommendations.some((r) => r.category === "READ_REPLICAS")).toBe(true);
  });

  it("recommends REDIS_SCALING for cache-reliant scenario categories", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100, "BROWSE_PROFESSIONALS");
    const result = completedResult();
    const projections = service.projectForScenario(scenario, result);
    const recommendations = service.recommendationsFor(scenario, projections);
    expect(recommendations.some((r) => r.category === "REDIS_SCALING")).toBe(true);
  });

  it("returns no recommendations for an empty projections array", () => {
    const service = new CapacityPlanningService();
    const scenario = makeScenario(100, "AUTHENTICATION");
    expect(service.recommendationsFor(scenario, [])).toHaveLength(0);
  });
});
