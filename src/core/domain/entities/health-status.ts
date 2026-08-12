/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The three states every health contributor in the platform reports in,
 * shared by the health-check framework and every consumer of it
 * (`/api/health/diagnostics`, `/api/health/circuit-breakers`). Kept as a
 * plain string union — not an enum — for the same reason every other
 * status field in this codebase (`CacheLayerHealthStatus`,
 * `SearchEngineHealthStatus`, `TracingHealthStatus`, ...) already is:
 * `HealthCheckResult` values are serialized straight into JSON HTTP
 * responses, and a TypeScript `enum` either serializes to a number
 * (wrong) or requires an extra mapping step a string union does not.
 *
 * - `HEALTHY` — fully operational.
 * - `DEGRADED` — operational but impaired (elevated latency, a
 *   secondary signal failing, a circuit breaker in `HALF_OPEN`) — still
 *   usable, worth an operator's attention.
 * - `UNHEALTHY` — not operational from this process's point of view
 *   (the check failed, timed out, or its circuit breaker is `OPEN`).
 */
export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

/** Numeric severity, `HEALTHY` lowest — the ordering `aggregateHealthStatus` folds over. */
const SEVERITY: Readonly<Record<HealthStatus, number>> = {
  HEALTHY: 0,
  DEGRADED: 1,
  UNHEALTHY: 2,
};

/**
 * One component's result, as reported to the platform health report.
 * Every field the module's spec requires is present unconditionally
 * except `details`/`error`, which are only meaningful — and therefore
 * only included — when there is something to say.
 */
export interface HealthCheckResult {
  readonly component: string;
  readonly status: HealthStatus;
  readonly responseTimeMs: number;
  readonly timestamp: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

/** The aggregated report every registered contributor rolls up into. */
export interface PlatformHealthReport {
  readonly status: HealthStatus;
  readonly timestamp: string;
  readonly checks: readonly HealthCheckResult[];
}

/**
 * Worst-status-wins aggregation: the platform is only as healthy as its
 * least healthy contributor. An empty list is `HEALTHY` — no registered
 * checks is not itself a failure, mirroring `DISABLED_*_HEALTH`
 * precedents elsewhere in this codebase treating "nothing to check" as a
 * healthy, not a failing, state.
 */
export function aggregateHealthStatus(statuses: readonly HealthStatus[]): HealthStatus {
  let worst: HealthStatus = "HEALTHY";
  for (const status of statuses) {
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst;
}
