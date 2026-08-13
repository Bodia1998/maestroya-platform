import { describe, expect, it } from "vitest";

import { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";
import { ComparePerformanceBaselineUseCase } from "@/application/use-cases/performance/compare-performance-baseline.use-case";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");
const t1 = new Date("2026-01-02T00:00:00.000Z");
const thresholds = { minorPercent: 10, moderatePercent: 25, severePercent: 50, criticalPercent: 100 };

function completedResult(scenarioId: string, samples: number[]): LoadTestResult {
  const result = LoadTestResult.schedule(`result-${scenarioId}`, scenarioId, null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.fromSamples(samples),
      throughput: { requestsPerSecond: 40, transactionsPerSecond: 39 },
      resourceEstimate: { cpuPercent: 5, memoryMB: 200, dbConnectionPoolUtilizationPercent: 5, cacheHitRatioPercent: 50 },
      totalRequests: 100,
      failedRequests: 1,
      timedOutRequests: 0,
      retriedRequests: 0,
    },
    t0,
  );
  return result;
}

describe("application/use-cases/performance/compare-performance-baseline — ComparePerformanceBaselineUseCase", () => {
  it("compares a caller-supplied result directly against a caller-supplied baseline", async () => {
    const baselineResult = completedResult("authentication", [50, 80, 100, 120, 150]);
    const baseline = PerformanceBaseline.capture("baseline-1", baselineResult, "pre-release", t0);
    const laterResult = completedResult("authentication", [50, 80, 100, 120, 150]);

    const useCase = new ComparePerformanceBaselineUseCase({
      comparisonService: new BaselineComparisonService(thresholds),
      now: () => t1,
    });

    const regression = await useCase.execute({ result: laterResult, baseline });

    expect(regression.scenarioId).toBe("authentication");
    expect(regression.baselineLabel).toBe("pre-release");
    expect(regression.overallSeverity).toBe("NONE");
    expect(regression.comparedAt).toBe(t1);
  });

  it("classifies a materially worse result as a regression", async () => {
    const baselineResult = completedResult("authentication", [50, 80, 100, 120, 150]);
    const baseline = PerformanceBaseline.capture("baseline-2", baselineResult, "pre-release", t0);
    const worseResult = completedResult("authentication", [500, 800, 1000, 1200, 1500]);

    const useCase = new ComparePerformanceBaselineUseCase({
      comparisonService: new BaselineComparisonService(thresholds),
      now: () => t1,
    });

    const regression = await useCase.execute({ result: worseResult, baseline });

    expect(regression.overallSeverity).not.toBe("NONE");
  });

  it("resolves the scenario's most recently stored baseline via the repository when no explicit baseline is supplied", async () => {
    const baselineResult = completedResult("authentication", [50, 80, 100, 120, 150]);
    const storedBaseline = PerformanceBaseline.capture("baseline-3", baselineResult, "auto-captured", t0);
    const laterResult = completedResult("authentication", [500, 800, 1000, 1200, 1500]);

    const baselineRepository = {
      save: async () => {},
      findByScenarioAndLabel: async () => null,
      findLatestByScenario: async () => storedBaseline,
      list: async () => [storedBaseline],
    };

    const useCase = new ComparePerformanceBaselineUseCase({
      comparisonService: new BaselineComparisonService(thresholds),
      now: () => t1,
      baselineRepository,
    });

    const regression = await useCase.execute({ result: laterResult });

    expect(regression.baselineLabel).toBe("auto-captured");
    expect(regression.overallSeverity).not.toBe("NONE");
  });

  it("throws NotFoundError when no explicit baseline is supplied and no repository is configured", async () => {
    const result = completedResult("authentication", [50, 80, 100, 120, 150]);
    const useCase = new ComparePerformanceBaselineUseCase({
      comparisonService: new BaselineComparisonService(thresholds),
      now: () => t1,
    });

    await expect(useCase.execute({ result })).rejects.toThrow();
  });
});
