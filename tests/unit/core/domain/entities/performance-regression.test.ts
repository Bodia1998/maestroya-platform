import { describe, expect, it } from "vitest";

import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import { PerformanceRegression, type RegressionThresholds } from "@/domain/entities/performance-regression";
import { ValidationError } from "@/domain/errors/domain-error";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");
const thresholds: RegressionThresholds = { minorPercent: 10, moderatePercent: 25, severePercent: 50, criticalPercent: 100 };

function completedResult(id: string, scenarioId: string, p95: number, errorRate: number, rps: number): LoadTestResult {
  const totalRequests = 1000;
  const failedRequests = Math.round(errorRate * totalRequests);
  const result = LoadTestResult.schedule(id, scenarioId, null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.rehydrate({ sampleCount: 100, min: 1, max: p95 * 2, average: p95 / 2, median: p95 / 2, p95, p99: p95 * 1.1 }),
      throughput: { requestsPerSecond: rps, transactionsPerSecond: rps * (1 - errorRate) },
      resourceEstimate: { cpuPercent: 10, memoryMB: 100, dbConnectionPoolUtilizationPercent: 10, cacheHitRatioPercent: 50 },
      totalRequests,
      failedRequests,
      timedOutRequests: 0,
      retriedRequests: 0,
    },
    t0,
  );
  return result;
}

function baselineFor(scenarioId: string, p95: number, errorRate: number, rps: number): PerformanceBaseline {
  return PerformanceBaseline.capture("baseline-1", completedResult("source", scenarioId, p95, errorRate, rps), "v1", t0);
}

describe("domain/entities/performance-regression — PerformanceRegression.compute", () => {
  it("classifies NONE when nothing changed", () => {
    const baseline = baselineFor("s1", 200, 0.01, 100);
    const result = completedResult("r1", "s1", 200, 0.01, 100);
    const regression = PerformanceRegression.compute(baseline, result, thresholds, t0);
    expect(regression.overallSeverity).toBe("NONE");
  });

  it("classifies a p95 latency increase by severity threshold", () => {
    const baseline = baselineFor("s1", 100, 0.01, 100);
    // +60% p95 -> SEVERE (>= 50, < 100)
    const result = completedResult("r1", "s1", 160, 0.01, 100);
    const regression = PerformanceRegression.compute(baseline, result, thresholds, t0);
    const p95Metric = regression.metrics.find((m) => m.metric === "p95LatencyMs")!;
    expect(p95Metric.changePercent).toBeCloseTo(60, 5);
    expect(p95Metric.severity).toBe("SEVERE");
    expect(regression.overallSeverity).toBe("SEVERE");
  });

  it("classifies a throughput decrease as a regression (lower is worse)", () => {
    const baseline = baselineFor("s1", 100, 0.01, 200);
    // -30% throughput -> MODERATE (>= 25, < 50)
    const result = completedResult("r1", "s1", 100, 0.01, 140);
    const regression = PerformanceRegression.compute(baseline, result, thresholds, t0);
    const throughputMetric = regression.metrics.find((m) => m.metric === "requestsPerSecond")!;
    expect(throughputMetric.changePercent).toBeCloseTo(30, 5);
    expect(throughputMetric.severity).toBe("MODERATE");
  });

  it("does not regress on a throughput increase", () => {
    const baseline = baselineFor("s1", 100, 0.01, 100);
    const result = completedResult("r1", "s1", 100, 0.01, 150);
    const regression = PerformanceRegression.compute(baseline, result, thresholds, t0);
    const throughputMetric = regression.metrics.find((m) => m.metric === "requestsPerSecond")!;
    expect(throughputMetric.severity).toBe("NONE");
  });

  it("overallSeverity is the worst of every individual metric", () => {
    const baseline = baselineFor("s1", 100, 0, 100);
    // error rate baseline 0 -> any non-zero current error rate is treated as the worst finite change (100%) -> CRITICAL
    const result = completedResult("r1", "s1", 100, 0.02, 100);
    const regression = PerformanceRegression.compute(baseline, result, thresholds, t0);
    expect(regression.overallSeverity).toBe("CRITICAL");
  });

  it("treats a baseline and result both at 0 error rate as NONE for that metric (no division by zero)", () => {
    const baseline = baselineFor("s1", 100, 0, 100);
    const result = completedResult("r1", "s1", 100, 0, 100);
    const regression = PerformanceRegression.compute(baseline, result, thresholds, t0);
    const errorRateMetric = regression.metrics.find((m) => m.metric === "errorRate")!;
    expect(errorRateMetric.severity).toBe("NONE");
    expect(errorRateMetric.changePercent).toBe(0);
  });

  it("rejects comparing across different scenarios", () => {
    const baseline = baselineFor("s1", 100, 0.01, 100);
    const result = completedResult("r1", "s2", 100, 0.01, 100);
    expect(() => PerformanceRegression.compute(baseline, result, thresholds, t0)).toThrow(ValidationError);
  });

  it("rejects a non-COMPLETED result", () => {
    const baseline = baselineFor("s1", 100, 0.01, 100);
    const pending = LoadTestResult.schedule("r1", "s1", null, t0);
    expect(() => PerformanceRegression.compute(baseline, pending, thresholds, t0)).toThrow(ValidationError);
  });
});
