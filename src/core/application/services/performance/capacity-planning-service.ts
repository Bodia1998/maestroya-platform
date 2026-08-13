import {
  CAPACITY_USER_TIERS,
  CapacityRecommendation,
  type CapacityProjection,
  type CapacityUserTier,
} from "@/domain/entities/capacity-report";
import type { LoadTestResult } from "@/domain/entities/load-test-result";
import type { PerformanceScenario } from "@/domain/entities/performance-scenario";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Extrapolates a scenario's *measured* behaviour, at the concurrency its
 * `WorkloadProfile` actually simulated, out to each tier in
 * `CAPACITY_USER_TIERS`, and turns the extrapolated resource usage into
 * `CapacityRecommendation`s once a tier crosses a documented threshold.
 *
 * ## Extrapolation method (documented, not hidden inside the formula)
 * Every quantity below is a deterministic function of `ratio = tier /
 * baselineVirtualUsers` — no randomness, fully reproducible.
 *
 * - **Throughput** grows **sub-linearly** (`ratio ^
 *   THROUGHPUT_GROWTH_EXPONENT`, exponent < 1): real systems get
 *   diminishing returns per added concurrent user as shared resources
 *   (connection pools, caches, the database itself) come under
 *   increasing contention — a pure linear projection overstates how much
 *   throughput actually scales at the largest tiers.
 * - **Memory** also grows **sub-linearly** (`ratio ^
 *   MEMORY_GROWTH_EXPONENT`) rather than linearly: shared caches and
 *   connection pooling mean per-additional-user memory cost shrinks at
 *   scale, not stays constant — a linear model summed across every
 *   scenario in the catalog (`report-generator.ts` sums memory
 *   platform-wide per tier) is what previously produced multi-terabyte
 *   totals at the largest tier.
 * - **CPU and DB-pool utilization** use `saturatingPercent()` — a smooth
 *   exponential-saturation curve rooted at the scenario's own measured
 *   baseline percentage, asymptotically approaching but never exceeding
 *   100 as `ratio` grows, replacing the previous `Math.min(100, base *
 *   ratio)` model that reached (and then flatly stayed at) 100 as soon as
 *   `ratio` crossed `100 / base` — often well before the largest tiers.
 * - **p95 latency** is scaled via `1 + log2(ratio) * LATENCY_GROWTH_FACTOR
 *   * (1 + saturationPressure * LATENCY_SATURATION_BOOST)` —
 *   `saturationPressure` is how close this tier's own CPU/DB-pool
 *   projection is to saturation (0–1). Queueing theory says latency
 *   degrades worse than linearly as a resource nears saturation; folding
 *   `saturationPressure` into the log-based growth factor makes latency
 *   climb faster exactly where CPU/DB-pool are already climbing fast,
 *   without the log term's own growth ever running away unboundedly.
 *
 * This is explicitly an **estimate for capacity planning purposes**, not
 * a guarantee — the whole report says so in its own summary
 * (`report-generator.ts`).
 */
const LATENCY_GROWTH_FACTOR = 0.4;
const LATENCY_SATURATION_BOOST = 1.2;
const THROUGHPUT_GROWTH_EXPONENT = 0.85;
const MEMORY_GROWTH_EXPONENT = 0.55;

const CPU_SATURATION_THRESHOLD_PERCENT = 80;
const DB_POOL_SATURATION_THRESHOLD_PERCENT = 85;
const CACHE_HIT_RATIO_FLOOR_PERCENT = 70;
const MEMORY_PER_INSTANCE_CEILING_MB = 4096;

/**
 * Exponential saturation curve rooted at a scenario's own measured
 * baseline percentage: solves for the rate `k` such that `f(1) ===
 * baselinePercent`, then evaluates `f(ratio) = 100 * (1 - e^(-k *
 * ratio))`. Monotonically increasing in `ratio`, bounded in `(0, 100)`,
 * and — unlike `Math.min(100, baselinePercent * ratio)` — never actually
 * reaches the ceiling, only approaches it, so a report can still
 * distinguish "95% at 5,000 users" from "99.9% at 100,000 users" instead
 * of both reading as an identical, uninformative 100%.
 */
function saturatingPercent(baselinePercent: number, ratio: number): number {
  if (ratio <= 0) return 0;
  const clampedBaseline = Math.min(99.9, Math.max(0.01, baselinePercent));
  const rate = -Math.log(1 - clampedBaseline / 100);
  return 100 * (1 - Math.exp(-rate * ratio));
}

export class CapacityPlanningService {
  projectForScenario(
    scenario: PerformanceScenario,
    result: LoadTestResult,
    tiers: readonly CapacityUserTier[] = CAPACITY_USER_TIERS,
  ): CapacityProjection[] {
    if (result.status !== "COMPLETED" || !result.latency || !result.throughput || !result.resourceEstimate) {
      throw new Error(`CapacityPlanningService.projectForScenario requires a COMPLETED LoadTestResult with metrics; result ${result.id} is ${result.status}.`);
    }

    const baselineUsers = scenario.workloadProfile.virtualUsers;

    return tiers.map((userTier) => {
      const ratio = userTier / baselineUsers;

      const projectedCpuPercent = saturatingPercent(result.resourceEstimate!.cpuPercent, ratio);
      const projectedDbConnectionPoolUtilizationPercent = saturatingPercent(result.resourceEstimate!.dbConnectionPoolUtilizationPercent, ratio);

      // How close this tier's own CPU/DB-pool projection already is to
      // saturation (0–1) — folded into the latency growth factor below so
      // latency climbs faster exactly where the platform is already under
      // the most pressure, not at a rate that's blind to it.
      const saturationPressure = Math.max(projectedCpuPercent, projectedDbConnectionPoolUtilizationPercent) / 100;
      const latencyGrowth = ratio <= 1 ? 1 : 1 + Math.log2(ratio) * LATENCY_GROWTH_FACTOR * (1 + saturationPressure * LATENCY_SATURATION_BOOST);

      return {
        scenarioId: scenario.id,
        userTier,
        projectedRequestsPerSecond: result.throughput!.requestsPerSecond * Math.pow(ratio, THROUGHPUT_GROWTH_EXPONENT),
        projectedP95LatencyMs: result.latency!.p95 * latencyGrowth,
        projectedCpuPercent,
        projectedMemoryMB: result.resourceEstimate!.memoryMB * Math.pow(ratio, MEMORY_GROWTH_EXPONENT),
        projectedDbConnectionPoolUtilizationPercent,
      };
    });
  }

  /** Threshold-based recommendations derived from one scenario's projections — a projection that never crosses any threshold produces zero recommendations, which is the expected, healthy case. */
  recommendationsFor(scenario: PerformanceScenario, projections: readonly CapacityProjection[]): CapacityRecommendation[] {
    const recommendations: CapacityRecommendation[] = [];
    if (projections.length === 0) return recommendations;

    const worstCpuTier = maxBy(projections, (p) => p.projectedCpuPercent);
    if (worstCpuTier.projectedCpuPercent >= CPU_SATURATION_THRESHOLD_PERCENT) {
      recommendations.push(
        new CapacityRecommendation(
          "HORIZONTAL_INSTANCES",
          `"${scenario.name}" projects ${worstCpuTier.projectedCpuPercent.toFixed(1)}% CPU at ${worstCpuTier.userTier.toLocaleString()} concurrent users — add instances before reaching this tier.`,
          worstCpuTier.projectedCpuPercent >= 95 ? "CRITICAL" : "HIGH",
        ),
      );
    }

    const worstDbTier = maxBy(projections, (p) => p.projectedDbConnectionPoolUtilizationPercent);
    if (worstDbTier.projectedDbConnectionPoolUtilizationPercent >= DB_POOL_SATURATION_THRESHOLD_PERCENT) {
      const category = scenario.category === "DATABASE_INTENSIVE" ? "DATABASE_SCALING" : "READ_REPLICAS";
      recommendations.push(
        new CapacityRecommendation(
          category,
          `"${scenario.name}" projects ${worstDbTier.projectedDbConnectionPoolUtilizationPercent.toFixed(1)}% DB connection-pool utilization at ${worstDbTier.userTier.toLocaleString()} concurrent users.`,
          worstDbTier.projectedDbConnectionPoolUtilizationPercent >= 95 ? "CRITICAL" : "HIGH",
        ),
      );
    }

    const worstMemoryTier = maxBy(projections, (p) => p.projectedMemoryMB);
    if (worstMemoryTier.projectedMemoryMB >= MEMORY_PER_INSTANCE_CEILING_MB) {
      recommendations.push(
        new CapacityRecommendation(
          "WORKER_COUNT",
          `"${scenario.name}" projects ${Math.round(worstMemoryTier.projectedMemoryMB).toLocaleString()}MB memory at ${worstMemoryTier.userTier.toLocaleString()} concurrent users — plan additional worker processes/instances.`,
          "MEDIUM",
        ),
      );
    }

    if (scenario.category === "SEARCH" || scenario.category === "BROWSE_PROFESSIONALS" || scenario.category === "MIXED_WORKLOAD") {
      // Cache pressure is only meaningful for cache-reliant categories —
      // see BenchmarkRunner's own per-category cache-hit-ratio modelling.
      recommendations.push(
        new CapacityRecommendation(
          "REDIS_SCALING",
          `"${scenario.name}" is cache-reliant — verify Redis capacity scales alongside projected traffic at the higher tiers to keep the cache-hit ratio above the ${CACHE_HIT_RATIO_FLOOR_PERCENT}% floor this platform targets.`,
          "LOW",
        ),
      );
    }

    return recommendations;
  }
}

/** Returns the element of `items` for which `selector` is largest. Callers must guarantee `items` is non-empty — this exists solely so `recommendationsFor`'s three "worst tier" lookups above don't each have to fight `noUncheckedIndexedAccess` over an already-guaranteed-non-empty array. */
function maxBy<T>(items: readonly T[], selector: (item: T) => number): T {
  let best = items[0] as T;
  for (const item of items) {
    if (selector(item) > selector(best)) best = item;
  }
  return best;
}
