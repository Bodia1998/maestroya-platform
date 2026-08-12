import type { HealthStatus } from "@/domain/entities/health-status";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * What one component's health check returns to `HealthCheckRegistry`.
 * Deliberately narrower than the full `HealthCheckResult` — `component`,
 * `responseTimeMs`, and `timestamp` are the registry's job to attach
 * uniformly (see `health-check-registry.ts`'s `runOne`), not each
 * contributor's. That is what keeps every contributor free of duplicate
 * timing/timestamping logic, the same "aggregation logic lives in one
 * place" rule `HealthCheckRegistry.runAll`'s worst-status aggregation
 * already follows.
 */
export interface HealthCheckOutcome {
  readonly status: HealthStatus;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

/**
 * The single abstraction the health-check framework depends on. Any
 * independent piece of the platform — a database, a cache, a queue, a
 * third-party API — registers one of these with `HealthCheckRegistry`;
 * the registry knows nothing about what a contributor actually checks.
 *
 * `check()` must never throw — `HealthCheckRegistry.runOne` treats a
 * thrown error as a bug in the contributor itself and reports it as
 * `UNHEALTHY`, but a well-behaved contributor should always resolve to
 * an outcome instead, the same "a health check must never itself become
 * an incident" contract every existing `collect*Health` function in this
 * codebase already honors.
 */
export interface HealthContributor {
  readonly name: string;
  check(): Promise<HealthCheckOutcome>;
}
