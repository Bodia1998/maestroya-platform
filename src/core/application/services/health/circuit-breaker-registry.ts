import type { CircuitBreakerConfig, CircuitBreakerSnapshot } from "@/domain/entities/circuit-breaker";
import { CircuitBreaker } from "@/domain/services/circuit-breaker";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Owns every named `CircuitBreaker` instance in the process — one per
 * external dependency (`postgres-primary`, `redis`, `stripe`,
 * `cloudinary`, `resend`, `twilio`, `opentelemetry`, `analytics`, one per
 * configured read replica, and any future dependency).
 *
 * `getOrCreate` is the failure-isolation boundary the module's spec
 * requires: each named breaker independently tracks its own state and
 * metrics, so a dependency tripping to `OPEN` can never affect any other
 * breaker's state — there is no shared counter or shared "circuit" of any
 * kind between them.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly defaultConfig: Partial<CircuitBreakerConfig> = {}) {}

  /** Returns the named breaker, constructing it (with `config` merged over the registry's defaults) the first time it's requested. */
  getOrCreate(name: string, config: Partial<CircuitBreakerConfig> = {}): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, { ...this.defaultConfig, ...config });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  list(): readonly string[] {
    return [...this.breakers.keys()];
  }

  getAllSnapshots(): readonly CircuitBreakerSnapshot[] {
    return [...this.breakers.values()].map((breaker) => breaker.getSnapshot());
  }

  /** Manually resets one named breaker to `CLOSED`. Returns `false` if no such breaker exists yet (never constructs one just to reset it). */
  reset(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (!breaker) return false;
    breaker.reset();
    return true;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) breaker.reset();
  }
}
