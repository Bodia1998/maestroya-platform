import type { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import { PerformanceRegression, type RegressionThresholds } from "@/domain/entities/performance-regression";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Thin orchestration around `PerformanceRegression.compute` — the same
 * "keep the pure computation on the domain entity, keep the service as
 * the thing application code actually injects/mocks" split
 * `BackupPlanningService` establishes. Kept as its own service (rather
 * than folding into `LoadTestingService`) because comparison is a
 * separate concern from execution — `DetectPerformanceRegressionUseCase`
 * needs it without running anything, and `GenerateCapacityReportUseCase`
 * needs it alongside `CapacityPlanningService`.
 */
export class BaselineComparisonService {
  constructor(private readonly thresholds: RegressionThresholds) {}

  compare(baseline: PerformanceBaseline, result: LoadTestResult, now: Date): PerformanceRegression {
    return PerformanceRegression.compute(baseline, result, this.thresholds, now);
  }
}
