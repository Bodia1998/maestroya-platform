import { describe, expect, it } from "vitest";

import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import { ValidationError } from "@/domain/errors/domain-error";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");

function completedResult(): LoadTestResult {
  const result = LoadTestResult.schedule("r1", "authentication", null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.fromSamples([10, 20, 30]),
      throughput: { requestsPerSecond: 100, transactionsPerSecond: 95 },
      resourceEstimate: { cpuPercent: 40, memoryMB: 512, dbConnectionPoolUtilizationPercent: 30, cacheHitRatioPercent: 80 },
      totalRequests: 100,
      failedRequests: 5,
      timedOutRequests: 1,
      retriedRequests: 2,
    },
    t0,
  );
  return result;
}

describe("domain/entities/performance-baseline — PerformanceBaseline.capture", () => {
  it("captures a snapshot from a COMPLETED result", () => {
    const result = completedResult();
    const baseline = PerformanceBaseline.capture("b1", result, "pre-release", t0);
    expect(baseline.scenarioId).toBe("authentication");
    expect(baseline.label).toBe("pre-release");
    expect(baseline.sourceResultId).toBe("r1");
    expect(baseline.latency.p95).toBe(result.latency!.p95);
    expect(baseline.errorRate).toBeCloseTo(0.05, 10);
  });

  it("rejects capturing from a non-COMPLETED result", () => {
    const result = LoadTestResult.schedule("r2", "authentication", null, t0);
    expect(() => PerformanceBaseline.capture("b2", result, "label", t0)).toThrow(ValidationError);
  });

  it("rejects an empty label", () => {
    const result = completedResult();
    expect(() => PerformanceBaseline.capture("b3", result, "   ", t0)).toThrow(ValidationError);
  });

  it("round-trips via rehydrate", () => {
    const result = completedResult();
    const baseline = PerformanceBaseline.capture("b4", result, "v1", t0);
    const rehydrated = PerformanceBaseline.rehydrate({
      id: baseline.id,
      scenarioId: baseline.scenarioId,
      label: baseline.label,
      capturedAt: baseline.capturedAt,
      sourceResultId: baseline.sourceResultId,
      latency: baseline.latency,
      throughput: baseline.throughput,
      resourceEstimate: baseline.resourceEstimate,
      errorRate: baseline.errorRate,
    });
    expect(rehydrated.label).toBe("v1");
  });
});
