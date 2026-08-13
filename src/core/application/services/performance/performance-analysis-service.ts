import type { CapacityBottleneck } from "@/domain/entities/capacity-report";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import type { PerformanceScenario } from "@/domain/entities/performance-scenario";
import type { RegressionSeverity } from "@/domain/entities/performance-regression";

const BOTTLENECK_P95_THRESHOLD_MS = 1000;
const BOTTLENECK_ERROR_RATE_THRESHOLD = 0.02;
const MAX_BOTTLENECKS_REPORTED = 5;

const REGRESSION_SEVERITY_PENALTY: Record<RegressionSeverity, number> = {
  NONE: 0,
  MINOR: 3,
  MODERATE: 8,
  SEVERE: 18,
  CRITICAL: 35,
};

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Cross-cutting analysis over a batch of `LoadTestResult`s: which
 * scenarios are the worst performers (`identifyBottlenecks`), and a single
 * `productionReadinessScore` (`computeProductionReadinessScore`) that
 * feeds `CapacityReport` and, ultimately, a production-readiness sign-off
 * decision.
 */
export class PerformanceAnalysisService {
  /**
   * Ranks scenarios by how far they exceed either threshold — p95 latency
   * over `BOTTLENECK_P95_THRESHOLD_MS` or error rate over
   * `BOTTLENECK_ERROR_RATE_THRESHOLD` — worst first, capped at
   * `MAX_BOTTLENECKS_REPORTED` so a report stays a punch list, not a
   * re-statement of every scenario. A scenario clearing both thresholds
   * is not a bottleneck and is excluded entirely.
   */
  identifyBottlenecks(results: readonly LoadTestResult[], scenarios: ReadonlyMap<string, PerformanceScenario>): CapacityBottleneck[] {
    const bottlenecks: CapacityBottleneck[] = [];

    for (const result of results) {
      if (result.status !== "COMPLETED" || !result.latency) continue;
      const scenario = scenarios.get(result.scenarioId);
      if (!scenario) continue;

      const latencyExceeded = result.latency.p95 > BOTTLENECK_P95_THRESHOLD_MS;
      const errorRateExceeded = result.errorRate > BOTTLENECK_ERROR_RATE_THRESHOLD;
      if (!latencyExceeded && !errorRateExceeded) continue;

      const reasons: string[] = [];
      if (latencyExceeded) reasons.push(`p95 latency ${result.latency.p95.toFixed(0)}ms exceeds ${BOTTLENECK_P95_THRESHOLD_MS}ms threshold`);
      if (errorRateExceeded) reasons.push(`error rate ${(result.errorRate * 100).toFixed(2)}% exceeds ${(BOTTLENECK_ERROR_RATE_THRESHOLD * 100).toFixed(2)}% threshold`);

      bottlenecks.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        p95LatencyMs: result.latency.p95,
        errorRate: result.errorRate,
        reason: reasons.join("; "),
      });
    }

    return bottlenecks
      .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs || b.errorRate - a.errorRate)
      .slice(0, MAX_BOTTLENECKS_REPORTED);
  }

  /**
   * Starts at 100 and deducts points for every bottleneck (weighted by how
   * far past threshold it is) and every regression (weighted by severity
   * via `REGRESSION_SEVERITY_PENALTY`), floored at 0. Deliberately a
   * simple, fully-documented additive penalty model rather than a
   * black-box formula — an operator reading a report must be able to see
   * *why* a score is what it is.
   */
  computeProductionReadinessScore(bottlenecks: readonly CapacityBottleneck[], regressionSeverities: readonly RegressionSeverity[]): number {
    let score = 100;

    for (const bottleneck of bottlenecks) {
      const latencyOverage = Math.max(0, bottleneck.p95LatencyMs - BOTTLENECK_P95_THRESHOLD_MS) / BOTTLENECK_P95_THRESHOLD_MS;
      const errorOverage = Math.max(0, bottleneck.errorRate - BOTTLENECK_ERROR_RATE_THRESHOLD) / BOTTLENECK_ERROR_RATE_THRESHOLD;
      score -= Math.min(20, 5 + (latencyOverage + errorOverage) * 10);
    }

    for (const severity of regressionSeverities) {
      score -= REGRESSION_SEVERITY_PENALTY[severity];
    }

    return Math.max(0, Math.round(score));
  }
}
