/**
 * Module 55 — Read Replicas.
 *
 * The single abstraction the application layer is allowed to know about
 * *how* a replica's health is measured. Nothing above
 * `infrastructure/database/` ever imports `PrismaClient` or issues a raw
 * SQL statement to determine health — exactly the same rule
 * `DatabaseBackupProvider` (Module 54) and `SearchIndexProvider` (Module
 * 47) already establish for `pg_dump` and Meilisearch/Typesense
 * respectively. `ReplicaHealthMonitorService`
 * (`application/services/database/replica-health-monitor-service.ts`)
 * is the only application-layer consumer, and it is fully unit-testable
 * against a plain fake implementing this interface.
 *
 * ## Never a source of failure
 * `ping`/`pingPrimary` must never throw — a health check that can itself
 * crash the thing it's checking is worse than no health check, the same
 * contract `CacheProvider.get` and `SearchIndexProvider.ping` already
 * state for their own ports. A failed ping is represented as
 * `{ healthy: false, ... }`, not a rejected promise.
 */
export interface ReplicaPingResult {
  readonly healthy: boolean;
  /** Round-trip latency of the ping itself, in milliseconds. `null` when the ping failed before a response arrived. */
  readonly latencyMs: number | null;
  /**
   * Streaming replication lag, in milliseconds, as reported by the
   * replica's own driver (e.g. Postgres's
   * `pg_last_xact_replay_timestamp()`). `null` when unavailable — either
   * the ping failed, or the target is not currently in recovery (a
   * primary, or a replica that has been promoted).
   */
  readonly replicationLagMs: number | null;
  /** Present only when `healthy` is `false` — why. */
  readonly error?: string;
}

export interface ReplicaHealthChecker {
  /** Pings one configured replica by the id `ReplicaRouterService` assigned it. */
  ping(replicaId: string): Promise<ReplicaPingResult>;
  /** Pings the primary — no replication lag is meaningful for it, so `replicationLagMs` is always `null` on success. */
  pingPrimary(): Promise<ReplicaPingResult>;
}
