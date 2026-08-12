import { describe, expect, it, vi } from "vitest";

const replicaQueryRaw = vi.fn();
const primaryQueryRaw = vi.fn();

vi.mock("@/infrastructure/database/prisma/replica-clients", () => ({
  getReplicaClient: vi.fn(() => ({ $queryRaw: replicaQueryRaw })),
}));

describe("infrastructure/database/prisma-replica-health-checker", () => {
  const replicas = [{ replicaId: "replica-0", connectionString: "postgresql://replica-0" }];

  it("ping() returns healthy: true with latency and lag on success", async () => {
    replicaQueryRaw.mockReset();
    replicaQueryRaw.mockResolvedValueOnce([{ "?column?": 1 }]).mockResolvedValueOnce([{ lag_ms: 42 }]);

    const { PrismaReplicaHealthChecker } = await import("@/infrastructure/database/prisma-replica-health-checker");
    const checker = new PrismaReplicaHealthChecker({ $queryRaw: primaryQueryRaw } as never, replicas);

    const result = await checker.ping("replica-0");
    expect(result.healthy).toBe(true);
    expect(result.replicationLagMs).toBe(42);
    expect(typeof result.latencyMs).toBe("number");
  });

  it("ping() returns replicationLagMs: null when the target is not in recovery", async () => {
    replicaQueryRaw.mockReset();
    replicaQueryRaw.mockResolvedValueOnce([{ "?column?": 1 }]).mockResolvedValueOnce([{ lag_ms: null }]);

    const { PrismaReplicaHealthChecker } = await import("@/infrastructure/database/prisma-replica-health-checker");
    const checker = new PrismaReplicaHealthChecker({ $queryRaw: primaryQueryRaw } as never, replicas);

    const result = await checker.ping("replica-0");
    expect(result.healthy).toBe(true);
    expect(result.replicationLagMs).toBeNull();
  });

  it("ping() never throws — returns healthy: false with the error message on failure", async () => {
    replicaQueryRaw.mockReset();
    replicaQueryRaw.mockRejectedValueOnce(new Error("connection refused"));

    const { PrismaReplicaHealthChecker } = await import("@/infrastructure/database/prisma-replica-health-checker");
    const checker = new PrismaReplicaHealthChecker({ $queryRaw: primaryQueryRaw } as never, replicas);

    const result = await checker.ping("replica-0");
    expect(result.healthy).toBe(false);
    expect(result.error).toBe("connection refused");
    expect(result.latencyMs).toBeNull();
    expect(result.replicationLagMs).toBeNull();
  });

  it("ping() returns a descriptive failure for an unknown replica id, without touching any client", async () => {
    const { PrismaReplicaHealthChecker } = await import("@/infrastructure/database/prisma-replica-health-checker");
    const checker = new PrismaReplicaHealthChecker({ $queryRaw: primaryQueryRaw } as never, replicas);

    const result = await checker.ping("does-not-exist");
    expect(result.healthy).toBe(false);
    expect(result.error).toContain("does-not-exist");
  });

  it("pingPrimary() returns healthy: true on success, with replicationLagMs always null", async () => {
    primaryQueryRaw.mockReset();
    primaryQueryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);

    const { PrismaReplicaHealthChecker } = await import("@/infrastructure/database/prisma-replica-health-checker");
    const checker = new PrismaReplicaHealthChecker({ $queryRaw: primaryQueryRaw } as never, replicas);

    const result = await checker.pingPrimary();
    expect(result.healthy).toBe(true);
    expect(result.replicationLagMs).toBeNull();
  });

  it("pingPrimary() never throws on failure", async () => {
    primaryQueryRaw.mockReset();
    primaryQueryRaw.mockRejectedValueOnce(new Error("primary unreachable"));

    const { PrismaReplicaHealthChecker } = await import("@/infrastructure/database/prisma-replica-health-checker");
    const checker = new PrismaReplicaHealthChecker({ $queryRaw: primaryQueryRaw } as never, replicas);

    const result = await checker.pingPrimary();
    expect(result.healthy).toBe(false);
    expect(result.error).toBe("primary unreachable");
  });
});
