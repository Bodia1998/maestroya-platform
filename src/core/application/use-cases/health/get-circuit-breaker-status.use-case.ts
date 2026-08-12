import type { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";
import { toDependencyStatus, type DependencyStatus } from "@/application/services/health/dependency-status";
import type { CircuitBreakerSnapshot } from "@/domain/entities/circuit-breaker";

export interface CircuitBreakerStatusReport {
  readonly circuitBreakers: readonly CircuitBreakerSnapshot[];
  readonly dependencies: readonly DependencyStatus[];
}

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * Read path for `/api/health/circuit-breakers`'s `GET` — every breaker's
 * full snapshot (state, config, metrics) alongside the same data
 * reprojected as `DependencyStatus` (Requirement 3's
 * availability/latency/last-success/last-failure/error-count shape),
 * derived rather than separately computed (see `toDependencyStatus`'s
 * own doc comment).
 */
export class GetCircuitBreakerStatusUseCase {
  constructor(private readonly registry: CircuitBreakerRegistry) {}

  execute(): CircuitBreakerStatusReport {
    const circuitBreakers = this.registry.getAllSnapshots();
    return {
      circuitBreakers,
      dependencies: circuitBreakers.map(toDependencyStatus),
    };
  }
}
