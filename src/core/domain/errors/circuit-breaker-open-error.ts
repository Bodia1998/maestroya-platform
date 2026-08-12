/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Thrown by `CircuitBreaker.execute()` when the breaker is `OPEN` — the
 * wrapped function is never invoked. Callers that want to react
 * differently to "the dependency itself failed" versus "we didn't even
 * try, the breaker is protecting it" should check `instanceof
 * CircuitBreakerOpenError` before falling back / degrading.
 */
export class CircuitBreakerOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is open — rejecting execution without invoking the wrapped function.`);
    this.name = "CircuitBreakerOpenError";
  }
}
