import { describe, expect, it, vi } from "vitest";

import { CapacityPlanningService } from "@/application/services/performance/capacity-planning-service";
import { PerformanceAnalysisService } from "@/application/services/performance/performance-analysis-service";
import { BaselineComparisonService } from "@/application/services/performance/baseline-comparison-service";
import { LoadTestingService } from "@/application/services/performance/load-testing-service";
import { GenerateCapacityReportUseCase } from "@/application/use-cases/performance/generate-capacity-report.use-case";
import { PERFORMANCE_SCENARIO_CATALOG, findScenarioById } from "@/application/services/performance/performance-scenario-catalog";
import type { LoadTestExecutionOutcome, LoadTestExecutor } from "@/application/ports/load-test-executor";
import { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import { LoadTestResult } from "@/domain/entities/load-test-result";
import { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

const t0 = new Date("2026-01-01T00:00:00.000Z");
const thresholds = { minorPercent: 10, moderatePercent: 25, severePercent: 50, criticalPercent: 100 };

const successOutcome: LoadTestExecutionOutcome = {
  samples: Array.from({ length: 20 }, (_, i) => ({ latencyMs: 40 + i, succeeded: true, timedOut: false, retried: false })),
  resourceEstimate: { cpuPercent: 5, memoryMB: 200, dbConnectionPoolUtilizationPercent: 5, cacheHitRatioPercent: 50 },
};

function makeUseCase(executor: LoadTestExecutor, generateId: () => string = () => "report-1") {
  const loadTestingService = new LoadTestingService({ executor, generateId: () => "result-1", now: () => t0 });
  return new GenerateCapacityReportUseCase({
    loadTestingService,
    capacityPlanning: new CapacityPlanningService(),
    analysis: new PerformanceAnalysisService(),
    comparison: new BaselineComparisonService(thresholds),
    generateId,
    now: () => t0,
  });
}

function baselineFor(scenarioId: string): PerformanceBaseline {
  const result = LoadTestResult.schedule(`baseline-result-${scenarioId}`, scenarioId, null, t0);
  result.markRunning(t0);
  result.markCompleted(
    {
      latency: LatencyStatistics.fromSamples([50, 80, 100, 120, 150]),
      throughput: { requestsPerSecond: 40, transactionsPerSecond: 39 },
      resourceEstimate: { cpuPercent: 5, memoryMB: 200, dbConnectionPoolUtilizationPercent: 5, cacheHitRatioPercent: 50 },
      totalRequests: 100,
      failedRequests: 1,
      timedOutRequests: 0,
      retriedRequests: 0,
    },
    t0,
  );
  return PerformanceBaseline.capture(`baseline-${scenarioId}`, result, "pre-release", t0);
}

describe("application/use-cases/performance/generate-capacity-report — GenerateCapacityReportUseCase", () => {
  it("runs every requested scenario in memory and builds projections/results for each", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const useCase = makeUseCase(executor);

    const { report, results } = await useCase.execute({ scenarioIds: ["authentication", "search"] });

    expect(report.id).toBe("report-1");
    expect(results).toHaveLength(2);
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(report.projections.some((p) => p.scenarioId === "authentication")).toBe(true);
    expect(report.projections.some((p) => p.scenarioId === "search")).toBe(true);
  });

  it("defaults to the full scenario catalog when scenarioIds is omitted", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const useCase = makeUseCase(executor);

    const { results } = await useCase.execute();

    expect(executor.execute).toHaveBeenCalledTimes(PERFORMANCE_SCENARIO_CATALOG.length);
    expect(results).toHaveLength(PERFORMANCE_SCENARIO_CATALOG.length);
  });

  it("skips a scenario whose run fails, without failing the whole report", async () => {
    const executor: LoadTestExecutor = {
      execute: vi.fn(async (scenario) => {
        if (scenario.id === "search") throw new Error("simulator crashed");
        return successOutcome;
      }),
    };
    const useCase = makeUseCase(executor);

    const { report, results } = await useCase.execute({ scenarioIds: ["authentication", "search"] });

    expect(results).toHaveLength(1);
    expect(results[0]?.scenarioId).toBe("authentication");
    expect(report.bottlenecks).toHaveLength(0);
  });

  it("folds regression severity from a caller-supplied baseline into the readiness score", async () => {
    // A run whose latency/error rate is dramatically worse than the
    // baseline should push the readiness score down via the regression
    // penalty, even with no bottleneck present.
    const regressedOutcome: LoadTestExecutionOutcome = {
      samples: Array.from({ length: 20 }, () => ({ latencyMs: 900, succeeded: true, timedOut: false, retried: false })),
      resourceEstimate: successOutcome.resourceEstimate,
    };
    const executor: LoadTestExecutor = { execute: vi.fn(async () => regressedOutcome) };
    const useCase = makeUseCase(executor);
    const scenario = findScenarioById("authentication");
    expect(scenario).not.toBeNull();

    const { report } = await useCase.execute({ scenarioIds: ["authentication"], baselines: [baselineFor("authentication")] });

    expect(report.productionReadinessScore).toBeLessThan(100);
  });

  it("returns an empty report with score 100 when a scenario id is not in the catalog", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const useCase = makeUseCase(executor);

    const { report, results } = await useCase.execute({ scenarioIds: ["not-a-real-scenario"] });

    expect(results).toHaveLength(0);
    expect(report.bottlenecks).toHaveLength(0);
    expect(report.productionReadinessScore).toBe(100);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("persists every scenario's aggregated result via resultRepository.save when configured", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const loadTestingService = new LoadTestingService({ executor, generateId: () => "result-1", now: () => t0 });
    const save = vi.fn().mockResolvedValue(undefined);

    const useCase = new GenerateCapacityReportUseCase({
      loadTestingService,
      capacityPlanning: new CapacityPlanningService(),
      analysis: new PerformanceAnalysisService(),
      comparison: new BaselineComparisonService(thresholds),
      generateId: () => "report-1",
      now: () => t0,
      resultRepository: { save, findById: vi.fn(), findRecentByScenario: vi.fn(), findLatestByScenario: vi.fn() },
    });

    await useCase.execute({ scenarioIds: ["authentication"] });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].scenarioId).toBe("authentication");
  });

  it("does not fail the report when resultRepository.save rejects", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const loadTestingService = new LoadTestingService({ executor, generateId: () => "result-1", now: () => t0 });

    const useCase = new GenerateCapacityReportUseCase({
      loadTestingService,
      capacityPlanning: new CapacityPlanningService(),
      analysis: new PerformanceAnalysisService(),
      comparison: new BaselineComparisonService(thresholds),
      generateId: () => "report-1",
      now: () => t0,
      resultRepository: {
        save: vi.fn().mockRejectedValue(new Error("db unavailable")),
        findById: vi.fn(),
        findRecentByScenario: vi.fn(),
        findLatestByScenario: vi.fn(),
      },
    });

    const { results } = await useCase.execute({ scenarioIds: ["authentication"] });
    expect(results).toHaveLength(1);
  });

  it("auto-captures the first successful run as the scenario's baseline when none is stored yet", async () => {
    const executor: LoadTestExecutor = { execute: vi.fn(async () => successOutcome) };
    const loadTestingService = new LoadTestingService({ executor, generateId: () => "result-1", now: () => t0 });
    const saveBaseline = vi.fn().mockResolvedValue(undefined);

    const useCase = new GenerateCapacityReportUseCase({
      loadTestingService,
      capacityPlanning: new CapacityPlanningService(),
      analysis: new PerformanceAnalysisService(),
      comparison: new BaselineComparisonService(thresholds),
      generateId: () => "report-1",
      now: () => t0,
      baselineRepository: {
        save: saveBaseline,
        findByScenarioAndLabel: vi.fn().mockResolvedValue(null),
        findLatestByScenario: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
    });

    const { report } = await useCase.execute({ scenarioIds: ["authentication"] });

    expect(saveBaseline).toHaveBeenCalledTimes(1);
    expect(saveBaseline.mock.calls[0]?.[0].label).toBe("auto-captured");
    // A freshly auto-captured baseline has nothing to compare itself
    // against yet, so this run's own score is unaffected by regression.
    expect(report.productionReadinessScore).toBe(100);
  });

  it("compares against the stored baseline automatically when no explicit baseline is supplied", async () => {
    const regressedOutcome: LoadTestExecutionOutcome = {
      samples: Array.from({ length: 20 }, () => ({ latencyMs: 900, succeeded: true, timedOut: false, retried: false })),
      resourceEstimate: successOutcome.resourceEstimate,
    };
    const executor: LoadTestExecutor = { execute: vi.fn(async () => regressedOutcome) };
    const loadTestingService = new LoadTestingService({ executor, generateId: () => "result-1", now: () => t0 });
    const storedBaseline = baselineFor("authentication");

    const useCase = new GenerateCapacityReportUseCase({
      loadTestingService,
      capacityPlanning: new CapacityPlanningService(),
      analysis: new PerformanceAnalysisService(),
      comparison: new BaselineComparisonService(thresholds),
      generateId: () => "report-1",
      now: () => t0,
      baselineRepository: {
        save: vi.fn(),
        findByScenarioAndLabel: vi.fn(),
        findLatestByScenario: vi.fn().mockResolvedValue(storedBaseline),
        list: vi.fn(),
      },
    });

    const { report } = await useCase.execute({ scenarioIds: ["authentication"] });

    expect(report.productionReadinessScore).toBeLessThan(100);
  });
});
