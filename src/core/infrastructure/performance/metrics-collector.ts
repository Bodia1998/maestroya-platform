import type { ResourceEstimate } from "@/domain/entities/load-test-result";
import type { ScenarioCategory } from "@/domain/entities/performance-scenario";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * Aggregates a simulated run's concurrency and scenario category into a
 * `ResourceEstimate` — **estimates for capacity-planning purposes, never
 * measured OS/DB/cache metrics**, since `BenchmarkRunner` never touches a
 * real process, database, or cache (see that file's own doc comment for
 * why). Every per-category coefficient below is a documented, deliberately
 * simple linear model: `cpuPercent`/`memoryMB`/`dbConnectionPoolUtilization
 * Percent` all grow with `virtualUsers` at a category-specific rate, and
 * `cacheHitRatioPercent` is a roughly-constant property of the category
 * (a cache-friendly read scenario like `BROWSE_PROFESSIONALS` reports a
 * high ratio; a write-heavy scenario like `DATABASE_INTENSIVE` reports a
 * low one, since writes don't hit a read cache at all) that degrades
 * slightly as the error rate rises (a struggling backend serves fewer
 * cache-eligible responses).
 *
 * ## Calibration note
 * `MEMORY_SCALE_FACTOR` below brings baseline (i.e. at a scenario's own,
 * deliberately modest `workloadProfile.virtualUsers` sample concurrency)
 * memory down to a realistic order of magnitude — a few hundred MB to a
 * couple GB per scenario, not the multi-GB-per-scenario figures the raw
 * `baseMemoryMB`/`memoryMBPerUser` table alone implied. It's a single,
 * documented multiplier rather than hand-editing all sixteen rows, so the
 * *relative* shape of the table (cache-friendly reads cost less than
 * write-heavy flows) is untouched. A few `dbPoolPercentPerUser`/
 * `cpuPercentPerUser` values were also lowered where they reached ~100%
 * (or dominated every other scenario) at the scenario's own baseline
 * concurrency — that left `CapacityPlanningService`'s tier extrapolation
 * with nothing left to grow from, since a percentage already at its
 * ceiling before any extrapolation is applied instantly reports
 * "saturated" at every tier. `CapacityPlanningService.projectForScenario`
 * extrapolates this baseline out to every `CAPACITY_USER_TIERS` tier —
 * see its own doc comment for the (also recalibrated) sub-linear
 * memory/throughput growth and the smooth saturating-toward-100 CPU/
 * DB-pool curve that replaced a hard linear-then-clamp model.
 */
const MEMORY_SCALE_FACTOR = 0.4;

interface ResourceProfile {
  cpuPercentPerUser: number;
  baseMemoryMB: number;
  memoryMBPerUser: number;
  dbPoolPercentPerUser: number;
  baseCacheHitRatioPercent: number;
}

const RESOURCE_PROFILES: Record<ScenarioCategory, ResourceProfile> = {
  USER_REGISTRATION: { cpuPercentPerUser: 0.12, baseMemoryMB: 256, memoryMBPerUser: 0.4, dbPoolPercentPerUser: 0.25, baseCacheHitRatioPercent: 20 },
  AUTHENTICATION: { cpuPercentPerUser: 0.08, baseMemoryMB: 256, memoryMBPerUser: 0.2, dbPoolPercentPerUser: 0.15, baseCacheHitRatioPercent: 55 },
  PASSWORD_RESET: { cpuPercentPerUser: 0.1, baseMemoryMB: 200, memoryMBPerUser: 0.3, dbPoolPercentPerUser: 0.2, baseCacheHitRatioPercent: 15 },
  SEARCH: { cpuPercentPerUser: 0.06, baseMemoryMB: 384, memoryMBPerUser: 0.25, dbPoolPercentPerUser: 0.08, baseCacheHitRatioPercent: 80 },
  CREATE_SERVICE_REQUEST: { cpuPercentPerUser: 0.15, baseMemoryMB: 256, memoryMBPerUser: 0.35, dbPoolPercentPerUser: 0.3, baseCacheHitRatioPercent: 10 },
  BROWSE_PROFESSIONALS: { cpuPercentPerUser: 0.04, baseMemoryMB: 384, memoryMBPerUser: 0.15, dbPoolPercentPerUser: 0.05, baseCacheHitRatioPercent: 90 },
  SUBMIT_QUOTE: { cpuPercentPerUser: 0.14, baseMemoryMB: 256, memoryMBPerUser: 0.35, dbPoolPercentPerUser: 0.28, baseCacheHitRatioPercent: 10 },
  ACCEPT_QUOTE: { cpuPercentPerUser: 0.16, baseMemoryMB: 256, memoryMBPerUser: 0.4, dbPoolPercentPerUser: 0.32, baseCacheHitRatioPercent: 8 },
  BOOKING: { cpuPercentPerUser: 0.15, baseMemoryMB: 256, memoryMBPerUser: 0.35, dbPoolPercentPerUser: 0.3, baseCacheHitRatioPercent: 12 },
  MESSAGING: { cpuPercentPerUser: 0.07, baseMemoryMB: 320, memoryMBPerUser: 0.2, dbPoolPercentPerUser: 0.1, baseCacheHitRatioPercent: 35 },
  NOTIFICATIONS: { cpuPercentPerUser: 0.09, baseMemoryMB: 256, memoryMBPerUser: 0.2, dbPoolPercentPerUser: 0.12, baseCacheHitRatioPercent: 25 },
  STRIPE_PAYMENT_FLOW: { cpuPercentPerUser: 0.14, baseMemoryMB: 256, memoryMBPerUser: 0.4, dbPoolPercentPerUser: 0.22, baseCacheHitRatioPercent: 5 },
  ADMIN_DASHBOARD: { cpuPercentPerUser: 0.1, baseMemoryMB: 512, memoryMBPerUser: 1.2, dbPoolPercentPerUser: 0.25, baseCacheHitRatioPercent: 45 },
  CONCURRENT_API_TRAFFIC: { cpuPercentPerUser: 0.05, baseMemoryMB: 256, memoryMBPerUser: 0.15, dbPoolPercentPerUser: 0.025, baseCacheHitRatioPercent: 50 },
  DATABASE_INTENSIVE: { cpuPercentPerUser: 0.16, baseMemoryMB: 384, memoryMBPerUser: 0.6, dbPoolPercentPerUser: 0.55, baseCacheHitRatioPercent: 5 },
  MIXED_WORKLOAD: { cpuPercentPerUser: 0.1, baseMemoryMB: 384, memoryMBPerUser: 0.3, dbPoolPercentPerUser: 0.06, baseCacheHitRatioPercent: 45 },
};

export interface ResourceEstimateInputs {
  category: ScenarioCategory;
  virtualUsers: number;
  errorRate: number;
}

export function estimateResourceUsage(inputs: ResourceEstimateInputs): ResourceEstimate {
  const profile = RESOURCE_PROFILES[inputs.category];

  const cpuPercent = Math.min(100, inputs.virtualUsers * profile.cpuPercentPerUser);
  const memoryMB = (profile.baseMemoryMB + inputs.virtualUsers * profile.memoryMBPerUser) * MEMORY_SCALE_FACTOR;
  const dbConnectionPoolUtilizationPercent = Math.min(100, inputs.virtualUsers * profile.dbPoolPercentPerUser);
  // A struggling backend (higher error rate) serves proportionally fewer
  // cacheable successful responses — modelled as a simple linear
  // degradation of the category's baseline cache-hit ratio, floored at 0.
  const cacheHitRatioPercent = Math.max(0, profile.baseCacheHitRatioPercent * (1 - inputs.errorRate));

  return { cpuPercent, memoryMB, dbConnectionPoolUtilizationPercent, cacheHitRatioPercent };
}
