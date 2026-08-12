import "server-only";

import type { PrismaClient } from "@prisma/client";

import type { ReplicaHealthChecker, ReplicaPingResult } from "@/application/ports/replica-health-checker";
import type { ReplicaConnectionConfig } from "@/infrastructure/database/read-replica-config";
import { getReplicaClient } from "@/infrastructure/database/prisma/replica-clients";

/**
 * Module 55 — Read Replicas.
 *
 * The default `ReplicaHealthChecker` (`application/ports/`) — Postgres/
 * Prisma-specific, and the only file in this module that knows either.
 * `latencyMs` measures the round trip of a trivial `SELECT 1`, the same
 * technique `/api/health/ready`'s own `prisma.$queryRaw\`SELECT 1\``
 * check uses for the primary. `replicationLagMs` reads Postgres's own
 * `pg_last_xact_replay_timestamp()` — the standard way to measure
 * streaming-replication lag: it returns the timestamp of the last
 * transaction replayed on the replica, `null` while the server is not in
 * recovery (i.e. it is not a replica at all — promoted, or
 * misconfigured), which this method surfaces as `replicationLagMs: null`
 * rather than treating it as an error.
 *
 * Never throws — every failure (connection refused, timeout, a
 * replica that was never reachable) is caught and returned as
 * `{ healthy: false, error }`, per `ReplicaHealthChecker`'s own contract.
 */
export class PrismaReplicaHealthChecker implements ReplicaHealthChecker {
  constructor(
    private readonly primary: PrismaClient,
    private readonly replicas: readonly ReplicaConnectionConfig[],
  ) {}

  async ping(replicaId: string): Promise<ReplicaPingResult> {
    const replica = this.replicas.find((candidate) => candidate.replicaId === replicaId);
    if (!replica) {
      return { healthy: false, latencyMs: null, replicationLagMs: null, error: `Unknown replica id ${replicaId}.` };
    }

    const client = getReplicaClient(replica);
    const startedAt = Date.now();

    try {
      await client.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - startedAt;

      const lagRows = await client.$queryRaw<{ lag_ms: number | null }[]>`
        SELECT
          CASE
            WHEN pg_last_xact_replay_timestamp() IS NULL THEN NULL
            ELSE EXTRACT(EPOCH FROM (clock_timestamp() - pg_last_xact_replay_timestamp())) * 1000
          END AS lag_ms
      `;
      const replicationLagMs = lagRows[0]?.lag_ms ?? null;

      return { healthy: true, latencyMs, replicationLagMs };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: null,
        replicationLagMs: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async pingPrimary(): Promise<ReplicaPingResult> {
    const startedAt = Date.now();
    try {
      await this.primary.$queryRaw`SELECT 1`;
      return { healthy: true, latencyMs: Date.now() - startedAt, replicationLagMs: null };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: null,
        replicationLagMs: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
