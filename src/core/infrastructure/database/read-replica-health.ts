import type { ReplicaHealthSnapshot } from "@/domain/entities/read-replica";
import type { ReplicaRoutingSnapshot } from "@/application/services/database/replica-router-service";

/**
 * Module 55 — Read Replicas.
 *
 * The shape `/api/health/ready` reports under `checks.readReplicas` —
 * joining `checks.backup`/`checks.disasterRecovery` (Module 54) and
 * every other Module-4x/5x check in that route's established
 * **"operational visibility only"** category: reported, never allowed to
 * change the response's overall `status` or HTTP code. A replica that is
 * lagging, unreachable, or has never been pinged does not mean this
 * instance cannot serve traffic — every read the `$extends` hook would
 * have sent there instead falls back to the primary, which is exactly
 * what `checks.database` already covers as load-bearing.
 *
 * `"disabled"` (`READ_REPLICAS_ENABLED` not `"true"`, or `"true"` with no
 * configured replicas — the default either way) is a healthy, normal
 * state, exactly like `checks.backup`'s own `"disabled"`.
 *
 * `"degraded"` means read-replica routing is on but at least one
 * configured replica is currently `UNHEALTHY` or `UNKNOWN` — reads that
 * would have gone there are transparently falling back to the primary.
 * `"ok"` means every configured replica is `HEALTHY` or `DEGRADED` (a
 * `DEGRADED` replica is still eligible for routing — see
 * `ReplicaHealthState`'s own doc comment — so it does not by itself
 * downgrade this report either).
 */
export type ReadReplicaHealthStatus = "ok" | "degraded" | "disabled";

export interface ReadReplicaHealthReport {
  readonly status: ReadReplicaHealthStatus;
  readonly strategy: string;
  readonly primaryHealthy: boolean;
  readonly replicas: readonly ReplicaHealthSnapshot[];
  readonly issues: readonly string[];
}

export const DISABLED_READ_REPLICA_HEALTH: ReadReplicaHealthReport = {
  status: "disabled",
  strategy: "none",
  primaryHealthy: true,
  replicas: [],
  issues: [],
};

/**
 * Builds the report from an already-refreshed routing snapshot. Pure and
 * total — a health *check* must never itself become an incident,
 * mirroring `collectBackupHealth`/`collectTracingHealth` exactly.
 */
export function collectReadReplicaHealth(snapshot: ReplicaRoutingSnapshot, primaryHealthy: boolean): ReadReplicaHealthReport {
  if (!snapshot.enabled) return DISABLED_READ_REPLICA_HEALTH;

  const issues: string[] = [];

  if (!primaryHealthy) {
    issues.push("The primary database is not reachable from this instance.");
  }

  for (const replica of snapshot.replicas) {
    if (replica.state === "UNHEALTHY") {
      issues.push(`Replica ${replica.replicaId} is UNHEALTHY${replica.lastError ? `: ${replica.lastError}` : "."}`);
    } else if (replica.state === "UNKNOWN") {
      issues.push(`Replica ${replica.replicaId} has not reported a successful health check yet.`);
    }
  }

  return {
    status: issues.length === 0 ? "ok" : "degraded",
    strategy: snapshot.strategy,
    primaryHealthy,
    replicas: snapshot.replicas,
    issues,
  };
}
