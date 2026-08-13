import { describe, expect, it } from "vitest";

import { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";
import { DetectPerformanceRegressionUseCase } from "@/application/use-cases/performance/detect-performance-regression.use-case";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");
const t1 = new Date("2026-01-02T00:00:00.000Z");
const t2 = new Date("2026-01-03T00:00:00.000Z");
const thresholds = { minorPercent: 10, moderatePercent: 25, severePercent: 50, criticalPercent: 100 };

function completedResult(id: string, scenarioId: string, completedAt: Date, samples: number[]): LoadTestResult {
  const result = LoadTestResult.schedule(id, scenarioId, null, t0);
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
    completedAt,
  );
  return result;
}

function makeUseCase(): DetectPerformanceRegressionUseCase {
  return new DetectPerformanceRegressionUseCase({ comparisonService: new BaselineComparisonService(thresholds), now: () => t2 });
}

describe("application/use-cases/performance/detect-performance-regression — DetectPerformanceRegressionUseCase", () => {
  it("compares the most recent completed result for a scenario against the most recently captured baseline", async () => {
    const older = completedResult("r-old", "authentication", t0, [50, 80, 100, 120, 150]);
    const newer = completedResult("r-new", "authentication", t1, [500, 800, 1000, 1200, 1500]);
    const baseline = PerformanceBaseline.capture("baseline-1", older, "pre-release", t0);

    const regression = await makeUseCase().execute({ scenarioId: "authentication", results: [older, newer], baselines: [baseline] });

    expect(regression).not.toBeNull();
    expect(regression?.overallSeverity).not.toBe("NONE");
  });

  it("returns null when no completed result exists for the scenario", async () => {
    const regression = await makeUseCase().execute({ scenarioId: "authentication", results: [], baselines: [] });
    expect(regression).toBeNull();
  });

  it("returns null when no baseline exists for the scenario", async () => {
    const result = completedResult("r-1", "authentication", t0, [50, 80, 100, 120, 150]);
    const regression = await makeUseCase().execute({ scenarioId: "authentication", results: [result], baselines: [] });
    expect(regression).toBeNull();
  });

  it("falls back to the resultRepository/baselineRepository when results/baselines are omitted", async () => {
    const storedResult = completedResult("r-stored", "authentication", t1, [500, 800, 1000, 1200, 1500]);
    const baselineResult = completedResult("r-baseline", "authentication", t0, [50, 80, 100, 120, 150]);
    const storedBaseline = PerformanceBaseline.capture("baseline-stored", baselineResult, "auto-captured", t0);

    const useCase = new DetectPerformanceRegressionUseCase({
      comparisonService: new BaselineComparisonService(thresholds),
      now: () => t2,
      resultRepository: {
        save: async () => {},
        findById: async () => null,
        findRecentByScenario: async () => [storedResult],
        findLatestByScenario: async () => storedResult,
      },
      baselineRepository: {
        save: async () => {},
        findByScenarioAndLabel: async () => null,
        findLatestByScenario: async () => storedBaseline,
        list: async () => [storedBaseline],
      },
    });

    const regression = await useCase.execute({ scenarioId: "authentication" });

    expect(regression).not.toBeNull();
    expect(regression?.baselineLabel).toBe("auto-captured");
    expect(regression?.overallSeverity).not.toBe("NONE");
  });
});
