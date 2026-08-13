import { describe, expect, it } from "vitest";

import { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { RegressionThresholds } from "@/domain/entities/performance-regression";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");
const thresholds: RegressionThresholds = { minorPercent: 10, moderatePercent: 25, severePercent: 50, criticalPercent: 100 };

function completedResult(p95: number): LoadTestResult {
  const result = LoadTestResult.schedule("r1", "search", null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.rehydrate({ sampleCount: 10, min: 1, max: p95 * 2, average: p95 / 2, median: p95 / 2, p95, p99: p95 * 1.1 }),
      throughput: { requestsPerSecond: 100, transactionsPerSecond: 99 },
      resourceEstimate: { cpuPercent: 10, memoryMB: 100, dbConnectionPoolUtilizationPercent: 10, cacheHitRatioPercent: 80 },
      totalRequests: 100,
      failedRequests: 1,
      timedOutRequests: 0,
      retriedRequests: 0,
    },
    t0,
  );
  return result;
}

describe("application/services/performance/baseline-comparison-service — BaselineComparisonService.compare", () => {
  it("delegates to PerformanceRegression.compute with the configured thresholds", () => {
    const service = new BaselineComparisonService(thresholds);
    const baseline = PerformanceBaseline.capture("b1", completedResult(100), "v1", t0);
    const result = completedResult(300); // +200% -> CRITICAL
    const regression = service.compare(baseline, result, t0);
    expect(regression.overallSeverity).toBe("CRITICAL");
    expect(regression.baselineLabel).toBe("v1");
  });
});
