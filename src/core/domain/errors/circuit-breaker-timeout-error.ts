/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Thrown by `CircuitBreaker.execute()` when the wrapped function does
 * not settle within `CircuitBreakerConfig.timeoutMs`. Counted separately
 * from `CircuitBreakerMetrics.failureCount` — `timeoutCount` — so an
 * operator can tell "the dependency answered and said no" apart from
 * "the dependency never answered at all", which is a materially
 * different failure mode.
 */
export class CircuitBreakerTimeoutError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Circuit breaker "${breakerName}" timed out after ${timeoutMs}ms.`);
    this.name = "CircuitBreakerTimeoutError";
  }
}
