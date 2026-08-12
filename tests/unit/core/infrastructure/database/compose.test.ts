import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

vi.mock("@/infrastructure/database/prisma/client", () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
}));

const REPLICA_ENV_KEYS = [
  "READ_REPLICAS_ENABLED",
  "DATABASE_REPLICA_URLS",
  "READ_REPLICA_SELECTION_STRATEGY",
  "READ_REPLICA_DEFAULT_CONSISTENCY",
  "READ_REPLICA_FAILURE_THRESHOLD",
];

async function loadCompose(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  return import("@/infrastructure/database/compose");
}

describe("infrastructure/database/compose", () => {
  afterEach(() => {
    for (const key of REPLICA_ENV_KEYS) delete (process.env as Record<string, string | undefined>)[key];
    vi.resetModules();
  });

  describe("disabled mode (READ_REPLICAS_ENABLED unset — the default)", () => {
    it("getReadReplicaHealth() resolves to the disabled report without pinging anything", async () => {
      const { getReadReplicaHealth } = await loadCompose();
      await expect(getReadReplicaHealth()).resolves.toMatchObject({ status: "disabled" });
    });

    it("disconnectReadReplicas() is a safe no-op", async () => {
      const { disconnectReadReplicas } = await loadCompose();
      await expect(disconnectReadReplicas()).resolves.toBeUndefined();
    });
  });

  describe("enabled mode", () => {
    it("getReadReplicaHealth() refreshes through the injected health checker and reports the result", async () => {
      const { getReadReplicaHealth, __testing } = await loadCompose({
        READ_REPLICAS_ENABLED: "true",
        DATABASE_REPLICA_URLS: "postgresql://replica-0",
      });

      __testing.setHealthChecker({
        ping: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5, replicationLagMs: 10 }),
        pingPrimary: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 2, replicationLagMs: null }),
      });

      const report = await getReadReplicaHealth();
      expect(report.status).toBe("ok");
      expect(report.replicas).toHaveLength(1);
      expect(report.replicas[0]).toMatchObject({ replicaId: "replica-0", state: "HEALTHY" });
    });

    it("getReadReplicaHealth() reports 'degraded' once a replica trips to UNHEALTHY", async () => {
      // READ_REPLICA_FAILURE_THRESHOLD=1: a single failed ping is enough
      // to trip the circuit breaker — collectReadReplicaHealth only
      // flags an issue for UNHEALTHY/UNKNOWN, not the more tolerant
      // DEGRADED state a single failure alone would otherwise produce
      // (see ReplicaHealth's own doc comment).
      const { getReadReplicaHealth, __testing } = await loadCompose({
        READ_REPLICAS_ENABLED: "true",
        DATABASE_REPLICA_URLS: "postgresql://replica-0",
        READ_REPLICA_FAILURE_THRESHOLD: "1",
      });

      __testing.setHealthChecker({
        ping: vi.fn().mockResolvedValue({ healthy: false, latencyMs: null, replicationLagMs: null, error: "timeout" }),
        pingPrimary: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 2, replicationLagMs: null }),
      });

      const report = await getReadReplicaHealth();
      expect(report.status).toBe("degraded");
    });
  });
});
