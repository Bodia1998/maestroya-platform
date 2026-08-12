import type { ReplicaHealthChecker } from "@/application/ports/replica-health-checker";
import type { ReplicaRouterService } from "@/application/services/database/replica-router-service";

/**
 * Module 55 — Read Replicas.
 *
 * The *active* half of "health monitoring for replicas" — the passive
 * half is `ReplicaRouterService.recordSuccess`/`recordFailure` being fed
 * by every organic query the `$extends` hook routes. This service pings
 * every configured replica (and the primary, for the report's
 * completeness) through the injected `ReplicaHealthChecker` port and
 * folds each outcome into the shared `ReplicaRouterService`, so a
 * replica that has gone quiet (no organic reads have touched it
 * recently) still has its health refreshed the moment this runs.
 *
 * Deliberately *not* a background interval timer: this codebase's
 * existing periodic/scheduled work runs on Module 45's `JobScheduler`
 * (backed by a queue + worker, itself backed by Redis in production),
 * which is the wrong tool for a check that must also run correctly in a
 * serverless deployment where no process outlives a single request. This
 * service is instead invoked on demand by
 * `infrastructure/database/compose.ts`'s `getReadReplicaHealth()` —
 * itself called every time `/api/health/ready` is hit — the same
 * "freshness comes from being asked, not from a timer" convention
 * `checkCache`'s Redis `PING` and `getSearchEngineHealth()` already
 * establish in that same route. A production deployment's own
 * load-balancer/orchestrator readiness probe (typically every few
 * seconds) is what keeps this genuinely fresh in practice.
 *
 * Pings every target concurrently and never throws — a health check
 * that can itself fail the endpoint it reports on is worse than no
 * health check, the same contract `ReplicaHealthChecker.ping` states.
 */
export class ReplicaHealthMonitorService {
  constructor(
    private readonly checker: ReplicaHealthChecker,
    private readonly router: ReplicaRouterService,
  ) {}

  /**
   * Pings every configured replica, updates the router's health state
   * from each outcome, and returns whether the primary itself is
   * currently reachable — the report's own "at least the primary is up"
   * baseline. Resolves even if every single ping fails.
   */
  async refresh(): Promise<{ primaryHealthy: boolean }> {
    const replicaIds = this.router.replicaIds;

    const [primaryResult] = await Promise.all([
      this.checker.pingPrimary(),
      ...replicaIds.map(async (replicaId) => {
        const result = await this.checker.ping(replicaId);
        if (result.healthy) {
          this.router.recordSuccess(replicaId, result.latencyMs ?? 0, result.replicationLagMs);
        } else {
          this.router.recordFailure(replicaId, result.error ?? "replica health check failed.");
        }
      }),
    ]);

    return { primaryHealthy: primaryResult.healthy };
  }
}
