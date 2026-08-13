import { ValidationError } from "@/domain/errors/domain-error";
import type { PerformanceBaseline } from "@/domain/entities/performance-baseline";
import type { LoadTestResult } from "@/domain/entities/load-test-result";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * `PerformanceRegression` is a pure, computed diff between a
 * `PerformanceBaseline` and a later `LoadTestResult` for the same
 * scenario — never persisted as its own aggregate with a lifecycle of its
 * own (there is nothing to transition; a regression is a fact about two
 * already-immutable snapshots, computed fresh every time
 * `BaselineComparisonService.compare()` is called).
 */
export type RegressionSeverity = "NONE" | "MINOR" | "MODERATE" | "SEVERE" | "CRITICAL";

const SEVERITY_RANK: Record<RegressionSeverity, number> = {
  NONE: 0,
  MINOR: 1,
  MODERATE: 2,
  SEVERE: 3,
  CRITICAL: 4,
};

/** Configurable percentage-worse thresholds a metric's regression must cross to be classified at each severity — see `resolvePerformanceConfig()`'s defaults. */
export interface RegressionThresholds {
  minorPercent: number;
  moderatePercent: number;
  severePercent: number;
  criticalPercent: number;
}

export interface MetricRegression {
  metric: "p95LatencyMs" | "p99LatencyMs" | "errorRate" | "requestsPerSecond";
  baselineValue: number;
  currentValue: number;
  /** Positive means "worse" for every metric here — for latency/errorRate that's an increase, for `requestsPerSecond` (throughput) that's a *decrease*, already normalized by `computeMetricRegression` so callers never have to remember which direction is bad per metric. */
  changePercent: number;
  severity: RegressionSeverity;
}

export class PerformanceRegression {
  private constructor(
    readonly scenarioId: string,
    readonly baselineLabel: string,
    readonly comparedAt: Date,
    readonly metrics: readonly MetricRegression[],
    readonly overallSeverity: RegressionSeverity,
  ) {}

  /**
   * Computes the regression between `baseline` and `result`. Requires
   * `result` to belong to the same scenario `baseline` was captured for
   * and to be `COMPLETED` — comparing across scenarios or against an
   * incomplete run would silently produce a meaningless diff.
   */
  static compute(baseline: PerformanceBaseline, result: LoadTestResult, thresholds: RegressionThresholds, now: Date): PerformanceRegression {
    if (baseline.scenarioId !== result.scenarioId) {
      throw new ValidationError(
        `PerformanceRegression.compute: baseline scenario "${baseline.scenarioId}" does not match result scenario "${result.scenarioId}".`,
      );
    }
    if (result.status !== "COMPLETED" || !result.latency || !result.throughput) {
      throw new ValidationError(`PerformanceRegression.compute requires a COMPLETED LoadTestResult with metrics; result ${result.id} is ${result.status}.`);
    }

    const metrics: MetricRegression[] = [
      regressionFor("p95LatencyMs", baseline.latency.p95, result.latency.p95, "higherIsWorse", thresholds),
      regressionFor("p99LatencyMs", baseline.latency.p99, result.latency.p99, "higherIsWorse", thresholds),
      regressionFor("errorRate", baseline.errorRate, result.errorRate, "higherIsWorse", thresholds),
      regressionFor("requestsPerSecond", baseline.throughput.requestsPerSecond, result.throughput.requestsPerSecond, "lowerIsWorse", thresholds),
    ];

    const overallSeverity = metrics.reduce<RegressionSeverity>(
      (worst, metric) => (SEVERITY_RANK[metric.severity] > SEVERITY_RANK[worst] ? metric.severity : worst),
      "NONE",
    );

    return new PerformanceRegression(baseline.scenarioId, baseline.label, now, metrics, overallSeverity);
  }
}

function regressionFor(
  metric: MetricRegression["metric"],
  baselineValue: number,
  currentValue: number,
  direction: "higherIsWorse" | "lowerIsWorse",
  thresholds: RegressionThresholds,
): MetricRegression {
  // `errorRate`'s baseline can legitimately be exactly 0 (a clean baseline
  // run) — guard the division rather than producing Infinity/NaN, and
  // treat "went from 0 to some non-zero rate" as the worst-classifiable
  // finite change rather than an unrepresentable one.
  let changePercent: number;
  if (direction === "higherIsWorse") {
    changePercent = baselineValue === 0 ? (currentValue === 0 ? 0 : 100) : ((currentValue - baselineValue) / baselineValue) * 100;
  } else {
    changePercent = baselineValue === 0 ? 0 : ((baselineValue - currentValue) / baselineValue) * 100;
  }

  return { metric, baselineValue, currentValue, changePercent, severity: classify(changePercent, thresholds) };
}

function classify(changePercent: number, thresholds: RegressionThresholds): RegressionSeverity {
  if (changePercent >= thresholds.criticalPercent) return "CRITICAL";
  if (changePercent >= thresholds.severePercent) return "SEVERE";
  if (changePercent >= thresholds.moderatePercent) return "MODERATE";
  if (changePercent >= thresholds.minorPercent) return "MINOR";
  return "NONE";
}
