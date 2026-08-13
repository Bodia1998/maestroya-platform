import { ValidationError } from "@/domain/errors/domain-error";
import type { LoadTestResult, ResourceEstimate, ThroughputMetrics } from "@/domain/entities/load-test-result";
import type { LatencyStatistics } from "@/domain/value-objects/latency-distribution";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * `PerformanceBaseline` is an immutable snapshot of one `LoadTestResult`'s
 * key metrics for a given scenario, tagged with a human-chosen `label`
 * (e.g. `"pre-v2.3-release"`, `"2026-08-13-nightly"`) — the comparison
 * point `BaselineComparisonService` diffs a later result against to detect
 * regressions. Deliberately copies the metrics out of the `LoadTestResult`
 * rather than holding a reference/id alone: a baseline must keep meaning
 * the exact same thing even if the `LoadTestResult` it was captured from is
 * later pruned by a retention sweep (this module has none today, but
 * baselines are designed to outlive individual results regardless).
 */
export class PerformanceBaseline {
  private constructor(
    readonly id: string,
    readonly scenarioId: string,
    readonly label: string,
    readonly capturedAt: Date,
    readonly sourceResultId: string,
    readonly latency: LatencyStatistics,
    readonly throughput: ThroughputMetrics,
    readonly resourceEstimate: ResourceEstimate,
    readonly errorRate: number,
  ) {}

  /**
   * Captures a baseline from a `COMPLETED` `LoadTestResult`. Throws
   * `ValidationError` for anything else — a baseline captured from a
   * `FAILED`/still-`RUNNING` result would silently poison every future
   * regression comparison for the scenario, so this is refused at
   * construction time rather than left to be caught later.
   */
  static capture(id: string, result: LoadTestResult, label: string, now: Date): PerformanceBaseline {
    if (result.status !== "COMPLETED" || !result.latency || !result.throughput || !result.resourceEstimate) {
      throw new ValidationError(
        `PerformanceBaseline.capture requires a COMPLETED LoadTestResult with metrics; result ${result.id} is ${result.status}.`,
      );
    }
    if (!label.trim()) {
      throw new ValidationError("PerformanceBaseline.capture requires a non-empty label.");
    }
    return new PerformanceBaseline(
      id,
      result.scenarioId,
      label,
      now,
      result.id,
      result.latency,
      result.throughput,
      result.resourceEstimate,
      result.errorRate,
    );
  }

  /** Reconstructs a `PerformanceBaseline` from persisted state — the repository's own factory. */
  static rehydrate(fields: {
    id: string;
    scenarioId: string;
    label: string;
    capturedAt: Date;
    sourceResultId: string;
    latency: LatencyStatistics;
    throughput: ThroughputMetrics;
    resourceEstimate: ResourceEstimate;
    errorRate: number;
  }): PerformanceBaseline {
    return new PerformanceBaseline(
      fields.id,
      fields.scenarioId,
      fields.label,
      fields.capturedAt,
      fields.sourceResultId,
      fields.latency,
      fields.throughput,
      fields.resourceEstimate,
      fields.errorRate,
    );
  }
}
