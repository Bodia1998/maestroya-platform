import { describe, expect, it } from "vitest";

import { PerformanceAnalysisService } from "@/application/services/performance/performance-analysis-service";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceScenario, WorkloadProfile } from "@/domain/entities/performance-scenario";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function scenario(id: string, name: string): PerformanceScenario {
  return PerformanceScenario.define({
    id,
    name,
    category: "AUTHENTICATION",
    description: "test",
    workloadProfile: new WorkloadProfile(10, 60, 10),
  });
}

function completedResult(id: string, scenarioId: string, p95: number, errorRate: number): LoadTestResult {
  const totalRequests = 1000;
  const result = LoadTestResult.schedule(id, scenarioId, null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.rehydrate({ sampleCount: 10, min: 1, max: p95 * 2, average: p95 / 2, median: p95 / 2, p95, p99: p95 * 1.1 }),
      throughput: { requestsPerSecond: 100, transactionsPerSecond: 90 },
      resourceEstimate: { cpuPercent: 10, memoryMB: 100, dbConnectionPoolUtilizationPercent: 10, cacheHitRatioPercent: 80 },
      totalRequests,
      failedRequests: Math.round(errorRate * totalRequests),
      timedOutRequests: 0,
      retriedRequests: 0,
    },
    t0,
  );
  return result;
}

describe("application/services/performance/performance-analysis-service — identifyBottlenecks", () => {
  it("excludes scenarios that clear both thresholds", () => {
    const service = new PerformanceAnalysisService();
    const s1 = scenario("s1", "Healthy Scenario");
    const results = [completedResult("r1", "s1", 200, 0.001)];
    const bottlenecks = service.identifyBottlenecks(results, new Map([["s1", s1]]));
    expect(bottlenecks).toHaveLength(0);
  });

  it("flags a scenario exceeding the p95 latency threshold", () => {
    const service = new PerformanceAnalysisService();
    const s1 = scenario("s1", "Slow Scenario");
    const results = [completedResult("r1", "s1", 1500, 0.001)];
    const bottlenecks = service.identifyBottlenecks(results, new Map([["s1", s1]]));
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks.at(0)?.reason).toMatch(/p95 latency/);
  });

  it("flags a scenario exceeding the error-rate threshold", () => {
    const service = new PerformanceAnalysisService();
    const s1 = scenario("s1", "Flaky Scenario");
    const results = [completedResult("r1", "s1", 200, 0.1)];
    const bottlenecks = service.identifyBottlenecks(results, new Map([["s1", s1]]));
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks.at(0)?.reason).toMatch(/error rate/);
  });

  it("ranks worst first (by p95 latency, then error rate) and caps at 5", () => {
    const service = new PerformanceAnalysisService();
    const scenarios = new Map<string, PerformanceScenario>();
    const results: LoadTestResult[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = `s${i}`;
      scenarios.set(id, scenario(id, `Scenario ${i}`));
      results.push(completedResult(`r${i}`, id, 1100 + i * 100, 0.03));
    }
    const bottlenecks = service.identifyBottlenecks(results, scenarios);
    expect(bottlenecks).toHaveLength(5);
    // Highest p95 (s7) must come first.
    expect(bottlenecks.at(0)?.scenarioId).toBe("s7");
    for (let i = 1; i < bottlenecks.length; i += 1) {
      expect(bottlenecks[i - 1]?.p95LatencyMs).toBeGreaterThanOrEqual(bottlenecks[i]?.p95LatencyMs ?? 0);
    }
  });

  it("skips results with no matching scenario", () => {
    const service = new PerformanceAnalysisService();
    const results = [completedResult("r1", "unknown-scenario", 5000, 0.5)];
    const bottlenecks = service.identifyBottlenecks(results, new Map());
    expect(bottlenecks).toHaveLength(0);
  });
});

describe("application/services/performance/performance-analysis-service — computeProductionReadinessScore", () => {
  it("returns 100 with no bottlenecks and no regressions", () => {
    const service = new PerformanceAnalysisService();
    expect(service.computeProductionReadinessScore([], [])).toBe(100);
  });

  it("deducts more for CRITICAL regressions than for MINOR ones", () => {
    const service = new PerformanceAnalysisService();
    const minorScore = service.computeProductionReadinessScore([], ["MINOR"]);
    const criticalScore = service.computeProductionReadinessScore([], ["CRITICAL"]);
    expect(criticalScore).toBeLessThan(minorScore);
  });

  it("never goes below 0", () => {
    const service = new PerformanceAnalysisService();
    const score = service.computeProductionReadinessScore(
      [
        { scenarioId: "s1", scenarioName: "s1", p95LatencyMs: 100_000, errorRate: 0.9, reason: "x" },
        { scenarioId: "s2", scenarioName: "s2", p95LatencyMs: 100_000, errorRate: 0.9, reason: "x" },
      ],
      ["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL"],
    );
    expect(score).toBe(0);
  });
});
