import type { CircuitBreakerSnapshot, CircuitState } from "@/domain/entities/circuit-breaker";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The shape "Requirement 3 — External Dependency Monitoring" asks for:
 * availability, latency, last successful request, last failure, and
 * error count, per dependency. Deliberately *not* a separately tracked
 * data structure — every one of those fields is already recorded by
 * `CircuitBreaker.getSnapshot()` as a side effect of the breaker
 * protecting that same dependency's calls (see
 * `infrastructure/health/circuit-breaker-health-contributor.ts`), so
 * `toDependencyStatus` is a pure projection, not a second bookkeeping
 * path — the module's "avoid duplicate logic" constraint applied
 * directly.
 */
export interface DependencyStatus {
  readonly name: string;
  readonly available: boolean;
  readonly circuitState: CircuitState;
  readonly averageLatencyMs: number;
  readonly lastSuccessfulRequestAt: string | null;
  readonly lastFailureAt: string | null;
  readonly errorCount: number;
}

/** `available` is `false` only while the breaker is `OPEN` — the state that means "we are deliberately not calling this dependency right now". `HALF_OPEN` is still reported available (a trial call is being attempted). */
export function toDependencyStatus(snapshot: CircuitBreakerSnapshot): DependencyStatus {
  return {
    name: snapshot.name,
    available: snapshot.state !== "OPEN",
    circuitState: snapshot.state,
    averageLatencyMs: snapshot.metrics.averageLatencyMs,
    lastSuccessfulRequestAt: snapshot.metrics.lastSuccessAt,
    lastFailureAt: snapshot.metrics.lastFailureAt,
    errorCount: snapshot.metrics.failureCount + snapshot.metrics.timeoutCount,
  };
}
