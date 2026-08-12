import { describe, expect, it, vi } from "vitest";

import type { ReplicaHealthChecker, ReplicaPingResult } from "@/application/ports/replica-health-checker";
import { ReplicaHealthMonitorService } from "@/application/services/database/replica-health-monitor-service";
import { ReplicaRouterService } from "@/application/services/database/replica-router-service";
import { createReplicaSelector } from "@/domain/services/replica-selector";

function buildRouter(): ReplicaRouterService {
  return new ReplicaRouterService({
    replicas: [{ replicaId: "replica-0" }, { replicaId: "replica-1" }],
    selector: createReplicaSelector("ROUND_ROBIN"),
    thresholds: { failureThreshold: 3, recoveryThreshold: 2, maxLagMs: 30_000 },
    defaultConsistency: { level: "EVENTUAL", maxStalenessMs: 5000 },
    maxHealthAgeMs: null,
  });
}

class FakeChecker implements ReplicaHealthChecker {
  constructor(
    private readonly results: Record<string, ReplicaPingResult>,
    private readonly primaryResult: ReplicaPingResult = { healthy: true, latencyMs: 1, replicationLagMs: null },
  ) {}

  async ping(replicaId: string): Promise<ReplicaPingResult> {
    return this.results[replicaId] ?? { healthy: false, latencyMs: null, replicationLagMs: null, error: "unknown replica" };
  }

  async pingPrimary(): Promise<ReplicaPingResult> {
    return this.primaryResult;
  }
}

describe("application/services/database/replica-health-monitor-service", () => {
  it("feeds a successful ping into the router as a success, including its lag reading", async () => {
    const router = buildRouter();
    const checker = new FakeChecker({
      "replica-0": { healthy: true, latencyMs: 12, replicationLagMs: 250 },
      "replica-1": { healthy: true, latencyMs: 8, replicationLagMs: 0 },
    });

    const monitor = new ReplicaHealthMonitorService(checker, router);
    const { primaryHealthy } = await monitor.refresh();

    expect(primaryHealthy).toBe(true);
    const snapshot = router.snapshot();
    expect(snapshot.replicas.find((r) => r.replicaId === "replica-0")).toMatchObject({ state: "HEALTHY", lastLagMs: 250 });
    expect(snapshot.replicas.find((r) => r.replicaId === "replica-1")).toMatchObject({ state: "HEALTHY", lastLagMs: 0 });
  });

  it("feeds a failed ping into the router as a failure", async () => {
    const router = buildRouter();
    const checker = new FakeChecker({
      "replica-0": { healthy: false, latencyMs: null, replicationLagMs: null, error: "connection refused" },
      "replica-1": { healthy: true, latencyMs: 5, replicationLagMs: 10 },
    });

    const monitor = new ReplicaHealthMonitorService(checker, router);
    await monitor.refresh();

    const snapshot = router.snapshot();
    expect(snapshot.replicas.find((r) => r.replicaId === "replica-0")).toMatchObject({
      state: "DEGRADED",
      lastError: "connection refused",
    });
  });

  it("reports primaryHealthy: false without throwing when the primary ping fails", async () => {
    const router = buildRouter();
    const checker = new FakeChecker(
      { "replica-0": { healthy: true, latencyMs: 5, replicationLagMs: 0 }, "replica-1": { healthy: true, latencyMs: 5, replicationLagMs: 0 } },
      { healthy: false, latencyMs: null, replicationLagMs: null, error: "primary unreachable" },
    );

    const monitor = new ReplicaHealthMonitorService(checker, router);
    await expect(monitor.refresh()).resolves.toEqual({ primaryHealthy: false });
  });

  it("pings every replica and the primary concurrently", async () => {
    const router = buildRouter();
    const ping = vi.fn(async () => ({ healthy: true, latencyMs: 1, replicationLagMs: 0 }) as ReplicaPingResult);
    const pingPrimary = vi.fn(async () => ({ healthy: true, latencyMs: 1, replicationLagMs: null }) as ReplicaPingResult);
    const checker: ReplicaHealthChecker = { ping, pingPrimary };

    const monitor = new ReplicaHealthMonitorService(checker, router);
    await monitor.refresh();

    expect(ping).toHaveBeenCalledTimes(2);
    expect(pingPrimary).toHaveBeenCalledTimes(1);
  });
});
