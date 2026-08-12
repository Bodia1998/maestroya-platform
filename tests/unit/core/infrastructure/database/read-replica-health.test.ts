import { describe, expect, it } from "vitest";

import { collectReadReplicaHealth, DISABLED_READ_REPLICA_HEALTH } from "@/infrastructure/database/read-replica-health";
import type { ReplicaRoutingSnapshot } from "@/application/services/database/replica-router-service";

describe("infrastructure/database/read-replica-health", () => {
  it("returns DISABLED_READ_REPLICA_HEALTH when the snapshot reports disabled", () => {
    const snapshot: ReplicaRoutingSnapshot = { enabled: false, strategy: "none", replicas: [] };
    expect(collectReadReplicaHealth(snapshot, true)).toEqual(DISABLED_READ_REPLICA_HEALTH);
  });

  it("reports 'ok' when every replica is HEALTHY/DEGRADED and the primary is reachable", () => {
    const snapshot: ReplicaRoutingSnapshot = {
      enabled: true,
      strategy: "ROUND_ROBIN",
      replicas: [
        { replicaId: "replica-0", state: "HEALTHY", consecutiveFailures: 0, consecutiveSuccesses: 3, lastLatencyMs: 5, lastLagMs: 10, lastCheckedAt: new Date(), lastError: null },
        { replicaId: "replica-1", state: "DEGRADED", consecutiveFailures: 1, consecutiveSuccesses: 0, lastLatencyMs: 5, lastLagMs: 10, lastCheckedAt: new Date(), lastError: "timeout" },
      ],
    };

    const report = collectReadReplicaHealth(snapshot, true);
    expect(report.status).toBe("ok");
    expect(report.issues).toEqual([]);
  });

  it("reports 'degraded' and an issue when a replica is UNHEALTHY", () => {
    const snapshot: ReplicaRoutingSnapshot = {
      enabled: true,
      strategy: "ROUND_ROBIN",
      replicas: [
        { replicaId: "replica-0", state: "UNHEALTHY", consecutiveFailures: 3, consecutiveSuccesses: 0, lastLatencyMs: null, lastLagMs: null, lastCheckedAt: new Date(), lastError: "connection refused" },
      ],
    };

    const report = collectReadReplicaHealth(snapshot, true);
    expect(report.status).toBe("degraded");
    expect(report.issues[0]).toContain("replica-0");
    expect(report.issues[0]).toContain("connection refused");
  });

  it("reports 'degraded' when a replica has never reported a successful check (UNKNOWN)", () => {
    const snapshot: ReplicaRoutingSnapshot = {
      enabled: true,
      strategy: "ROUND_ROBIN",
      replicas: [
        { replicaId: "replica-0", state: "UNKNOWN", consecutiveFailures: 0, consecutiveSuccesses: 0, lastLatencyMs: null, lastLagMs: null, lastCheckedAt: null, lastError: null },
      ],
    };

    const report = collectReadReplicaHealth(snapshot, true);
    expect(report.status).toBe("degraded");
    expect(report.issues).toHaveLength(1);
  });

  it("reports an issue (and stays 'degraded') when the primary is unreachable", () => {
    const snapshot: ReplicaRoutingSnapshot = { enabled: true, strategy: "ROUND_ROBIN", replicas: [] };
    const report = collectReadReplicaHealth(snapshot, false);
    expect(report.status).toBe("degraded");
    expect(report.primaryHealthy).toBe(false);
    expect(report.issues[0]).toContain("primary database");
  });

  it("never throws — pure and total for any snapshot shape", () => {
    const snapshot: ReplicaRoutingSnapshot = { enabled: true, strategy: "LEAST_LAG", replicas: [] };
    expect(() => collectReadReplicaHealth(snapshot, true)).not.toThrow();
  });
});
