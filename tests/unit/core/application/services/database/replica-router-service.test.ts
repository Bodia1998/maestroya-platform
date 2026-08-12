import { describe, expect, it } from "vitest";

import { ReplicaRouterService, type ReplicaRouterServiceOptions } from "@/application/services/database/replica-router-service";
import type { ReplicaHealthThresholds } from "@/domain/entities/read-replica";
import { createReplicaSelector } from "@/domain/services/replica-selector";

const THRESHOLDS: ReplicaHealthThresholds = { failureThreshold: 3, recoveryThreshold: 2, maxLagMs: 30_000 };

function buildRouter(overrides: Partial<ReplicaRouterServiceOptions> = {}): ReplicaRouterService {
  return new ReplicaRouterService({
    replicas: [{ replicaId: "replica-0" }, { replicaId: "replica-1" }],
    selector: createReplicaSelector("ROUND_ROBIN"),
    thresholds: THRESHOLDS,
    defaultConsistency: { level: "EVENTUAL", maxStalenessMs: 5000 },
    maxHealthAgeMs: null,
    ...overrides,
  });
}

describe("application/services/database/replica-router-service", () => {
  it("routes write operations to the primary unconditionally", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5);
    expect(router.route("write")).toEqual({ target: "primary", reason: "write operations always target the primary." });
  });

  it("routes to the primary when no replicas are configured", () => {
    const router = buildRouter({ replicas: [] });
    expect(router.route("read")).toMatchObject({ target: "primary" });
  });

  it("routes reads to the primary when every replica is still UNKNOWN (never pinged)", () => {
    const router = buildRouter();
    expect(router.route("read")).toMatchObject({ target: "primary", reason: expect.stringContaining("no eligible replica") });
  });

  it("routes an eligible read to a HEALTHY replica once one has reported success", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5);
    const decision = router.route("read");
    expect(decision).toMatchObject({ target: "replica", replicaId: "replica-0" });
  });

  it("STRONG consistency always routes to the primary, even with healthy replicas", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5);
    router.recordSuccess("replica-1", 5);
    expect(router.route("read", { level: "STRONG", maxStalenessMs: 0 })).toMatchObject({ target: "primary" });
  });

  it("BOUNDED_STALENESS excludes a replica whose lag exceeds the bound", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5, 10_000);
    const decision = router.route("read", { level: "BOUNDED_STALENESS", maxStalenessMs: 1000 });
    expect(decision).toMatchObject({ target: "primary" });
  });

  it("BOUNDED_STALENESS routes to a replica within the bound", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5, 500);
    const decision = router.route("read", { level: "BOUNDED_STALENESS", maxStalenessMs: 1000 });
    expect(decision).toMatchObject({ target: "replica", replicaId: "replica-0" });
  });

  it("automatically falls back to the primary once a replica trips to UNHEALTHY", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5);
    router.recordFailure("replica-0", "e1");
    router.recordFailure("replica-0", "e2");
    router.recordFailure("replica-0", "e3");

    expect(router.route("read")).toMatchObject({ target: "primary" });
  });

  it("routes around an UNHEALTHY replica to a remaining HEALTHY one", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5);
    router.recordSuccess("replica-1", 5);
    router.recordFailure("replica-0", "e1");
    router.recordFailure("replica-0", "e2");
    router.recordFailure("replica-0", "e3");

    const decision = router.route("read");
    expect(decision).toMatchObject({ target: "replica", replicaId: "replica-1" });
  });

  it("recordSuccess/recordFailure on an unknown replica id are ignored, never throw", () => {
    const router = buildRouter();
    expect(() => router.recordSuccess("does-not-exist", 5)).not.toThrow();
    expect(() => router.recordFailure("does-not-exist", "boom")).not.toThrow();
  });

  it("a passive success (no lag argument) does not overwrite a previously measured lag", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5, 200);
    router.recordSuccess("replica-0", 5);

    const snapshot = router.snapshot();
    const replica = snapshot.replicas.find((r) => r.replicaId === "replica-0");
    expect(replica?.lastLagMs).toBe(200);
  });

  it("excludes a replica whose last signal is older than maxHealthAgeMs", () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const router = buildRouter({ maxHealthAgeMs: 10_000, now: () => now });
    router.recordSuccess("replica-0", 5);

    now = new Date("2026-01-01T00:00:20Z");
    expect(router.route("read")).toMatchObject({ target: "primary" });
  });

  it("snapshot() reports enabled=false and strategy='none'-independent shape when constructed with zero replicas", () => {
    const router = buildRouter({ replicas: [] });
    expect(router.isEnabled).toBe(false);
    expect(router.snapshot()).toMatchObject({ enabled: false, replicas: [] });
  });

  it("snapshot() reports every configured replica's current health", () => {
    const router = buildRouter();
    router.recordSuccess("replica-0", 5);
    const snapshot = router.snapshot();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.replicas).toHaveLength(2);
    expect(snapshot.replicas.find((r) => r.replicaId === "replica-0")?.state).toBe("HEALTHY");
    expect(snapshot.replicas.find((r) => r.replicaId === "replica-1")?.state).toBe("UNKNOWN");
  });
});
