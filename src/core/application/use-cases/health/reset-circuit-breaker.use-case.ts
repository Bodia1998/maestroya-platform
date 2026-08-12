import type { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";

export interface ResetCircuitBreakerInput {
  /** A specific breaker name, or `"all"` to reset every registered breaker. */
  readonly name: string;
}

export interface ResetCircuitBreakerResult {
  readonly reset: readonly string[];
  readonly notFound: readonly string[];
}

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The module's "manual reset" requirement — write path for
 * `/api/health/circuit-breakers`'s `POST`. An operator can force a
 * specific breaker (or every breaker) back to `CLOSED`, e.g. after
 * confirming a dependency has recovered and not wanting to wait out
 * `resetTimeoutMs`.
 */
export class ResetCircuitBreakerUseCase {
  constructor(private readonly registry: CircuitBreakerRegistry) {}

  execute(input: ResetCircuitBreakerInput): ResetCircuitBreakerResult {
    if (input.name === "all") {
      const names = this.registry.list();
      this.registry.resetAll();
      return { reset: names, notFound: [] };
    }

    const wasReset = this.registry.reset(input.name);
    return wasReset ? { reset: [input.name], notFound: [] } : { reset: [], notFound: [input.name] };
  }
}
