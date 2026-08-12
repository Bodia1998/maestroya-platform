import type { HealthContributor } from "@/application/ports/health-contributor";
import { aggregateHealthStatus, type HealthCheckResult, type PlatformHealthReport } from "@/domain/entities/health-status";

/**
 * Module 56 — Health Checks & Circuit Breakers.
 *
 * The reusable health-check framework's aggregation point. Independent
 * `HealthContributor`s register here; `runAll()` executes every one of
 * them concurrently and folds the results into a single
 * `PlatformHealthReport` via `aggregateHealthStatus` (worst-status-wins).
 *
 * Infrastructure-independent by construction: this class only knows the
 * `HealthContributor` port, never a concrete database, cache, or HTTP
 * client — `infrastructure/health/compose.ts` is the one place that
 * constructs the registry and registers concrete contributors.
 */
export class HealthCheckRegistry {
  private readonly contributors = new Map<string, HealthContributor>();

  register(contributor: HealthContributor): void {
    this.contributors.set(contributor.name, contributor);
  }

  unregister(name: string): void {
    this.contributors.delete(name);
  }

  list(): readonly string[] {
    return [...this.contributors.keys()];
  }

  /**
   * Runs every registered contributor concurrently and aggregates the
   * results. Never throws — a failing individual check is captured by
   * `runOne` and reported as an `UNHEALTHY` result, never allowed to
   * abort the whole report.
   */
  async runAll(now: () => Date = () => new Date()): Promise<PlatformHealthReport> {
    const checks = await Promise.all([...this.contributors.values()].map((contributor) => this.runOne(contributor, now)));

    return {
      status: aggregateHealthStatus(checks.map((check) => check.status)),
      timestamp: now().toISOString(),
      checks,
    };
  }

  /** Runs a single named contributor, if registered. `null` when no contributor with that name is registered. */
  async runByName(name: string, now: () => Date = () => new Date()): Promise<HealthCheckResult | null> {
    const contributor = this.contributors.get(name);
    if (!contributor) return null;
    return this.runOne(contributor, now);
  }

  private async runOne(contributor: HealthContributor, now: () => Date): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const outcome = await contributor.check();
      return {
        component: contributor.name,
        status: outcome.status,
        responseTimeMs: Date.now() - start,
        timestamp: now().toISOString(),
        ...(outcome.details ? { details: outcome.details } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    } catch (error) {
      return {
        component: contributor.name,
        status: "UNHEALTHY",
        responseTimeMs: Date.now() - start,
        timestamp: now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
