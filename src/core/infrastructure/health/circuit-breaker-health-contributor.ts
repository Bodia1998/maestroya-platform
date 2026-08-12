import "server-only";

import type { CircuitBreakerRegistry } from "@/application/services/health/circuit-breaker-registry";
import type { HealthCheckOutcome, HealthContributor } from "@/application/ports/health-contributor";
import type { CircuitBreakerConfig } from "@/domain/entities/circuit-breaker";
import { CircuitBreakerOpenError } from "@/domain/errors/circuit-breaker-open-error";
import { CircuitBreakerTimeoutError } from "@/domain/errors/circuit-breaker-timeout-error";
import { normalizeHealthStatus } from "@/infrastructure/health/health-status-normalizer";

/**
 * The minimum shape every existing `collect*Health`/`get*Health` function
 * already returns — a `status` string plus whatever else that module
 * reports. Deliberately has no index signature (unlike a `Record<string,
 * unknown>`): every existing report type (`ReadReplicaHealthReport`,
 * `CacheLayerHealthReport`, ...) is a plain interface without one, and
 * TypeScript only allows assigning such an interface to a type *with* an
 * index signature when the source itself declares one too. Requiring
 * only `{ status: string }` here — checked structurally, no index
 * signature involved — is what lets every existing report type flow
 * through `collect` unchanged.
 */
export interface RawHealthReport {
  readonly status: string;
}

export interface CircuitBreakerHealthContributorOptions<T extends RawHealthReport> {
  readonly name: string;
  readonly registry: CircuitBreakerRegistry;
  readonly config?: Partial<CircuitBreakerConfig>;
  /** The existing collector this dependency already has — never reimplemented, only wrapped. */
  readonly collect: () => Promise<T> | T;
}

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The integration point between the new framework and every dependency
 * this codebase already knows how to check (Modules 44-55): wraps an
 * existing collector in its own dedicated `CircuitBreaker`, runs it
 * through that breaker on every call, and adapts the result into a
 * `HealthContributor` the registry understands.
 *
 * This is what makes "Failure Isolation" (Requirement 4) real rather
 * than aspirational: each dependency's health check executes through its
 * own named breaker, so a health check that hangs (e.g. a database
 * driver that never returns) trips only that dependency's breaker and is
 * bounded by `config.timeoutMs` — it can never block or fail any other
 * dependency's check, and `HealthCheckRegistry.runAll`'s
 * `Promise.all` already runs every contributor concurrently on top of
 * that.
 *
 * When the breaker is `OPEN`, the wrapped collector is not invoked at
 * all (by design — see `CircuitBreaker.execute`) and the contributor
 * reports `UNHEALTHY` with `circuitState: "OPEN"` in `details`, which is
 * exactly what an operator needs to see: not "the last check failed" but
 * "we are deliberately not even trying right now".
 */
export function createCircuitBreakerHealthContributor<T extends RawHealthReport>(
  options: CircuitBreakerHealthContributorOptions<T>,
): HealthContributor {
  return {
    name: options.name,
    async check(): Promise<HealthCheckOutcome> {
      const breaker = options.registry.getOrCreate(options.name, options.config);

      try {
        const raw = await breaker.execute(async () => options.collect());
        const { status, ...details } = raw;
        return {
          status: normalizeHealthStatus(status),
          ...(Object.keys(details).length > 0 ? { details } : {}),
        };
      } catch (error) {
        if (error instanceof CircuitBreakerOpenError) {
          return {
            status: "UNHEALTHY",
            details: { circuitState: "OPEN" },
            error: error.message,
          };
        }
        if (error instanceof CircuitBreakerTimeoutError) {
          return {
            status: "UNHEALTHY",
            details: { circuitState: breaker.currentState, timedOut: true },
            error: error.message,
          };
        }
        return {
          status: "UNHEALTHY",
          details: { circuitState: breaker.currentState },
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
