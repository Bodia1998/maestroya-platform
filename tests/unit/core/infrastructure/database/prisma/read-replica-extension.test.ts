import { describe, expect, it, vi } from "vitest";

import { READ_OPERATIONS, routeToReplica, toDelegateName } from "@/infrastructure/database/prisma/read-replica-extension";
import { ReplicaRouterService } from "@/application/services/database/replica-router-service";
import { createReplicaSelector } from "@/domain/services/replica-selector";

function buildRouter(): ReplicaRouterService {
  return new ReplicaRouterService({
    replicas: [{ replicaId: "replica-0" }],
    selector: createReplicaSelector("ROUND_ROBIN"),
    thresholds: { failureThreshold: 3, recoveryThreshold: 2, maxLagMs: 30_000 },
    defaultConsistency: { level: "EVENTUAL", maxStalenessMs: 5000 },
    maxHealthAgeMs: null,
  });
}

describe("infrastructure/database/prisma/read-replica-extension", () => {
  describe("READ_OPERATIONS", () => {
    it("includes every read-only model delegate method", () => {
      for (const op of ["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]) {
        expect(READ_OPERATIONS.has(op)).toBe(true);
      }
    });

    it("excludes every write method", () => {
      for (const op of ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany"]) {
        expect(READ_OPERATIONS.has(op)).toBe(false);
      }
    });
  });

  describe("toDelegateName", () => {
    it("lowercases the first character of the Prisma model name", () => {
      expect(toDelegateName("User")).toBe("user");
      expect(toDelegateName("ServiceRequest")).toBe("serviceRequest");
    });
  });

  describe("routeToReplica", () => {
    it("executes the operation against the replica's own delegate and records success", async () => {
      const router = buildRouter();
      const recordSuccess = vi.spyOn(router, "recordSuccess");
      const findMany = vi.fn().mockResolvedValue([{ id: "1" }]);
      const replicaClient = { user: { findMany } };
      const query = vi.fn();

      const result = await routeToReplica({
        model: "User",
        operation: "findMany",
        args: { where: { id: "1" } },
        query,
        decision: { target: "replica", replicaId: "replica-0", reason: "test" },
        router,
        resolveReplicaClient: () => replicaClient as never,
      });

      expect(result).toEqual([{ id: "1" }]);
      expect(findMany).toHaveBeenCalledWith({ where: { id: "1" } });
      expect(query).not.toHaveBeenCalled();
      expect(recordSuccess).toHaveBeenCalledWith("replica-0", expect.any(Number));
    });

    it("falls back to the primary query and records a failure when the replica call throws", async () => {
      const router = buildRouter();
      const recordFailure = vi.spyOn(router, "recordFailure");
      const findMany = vi.fn().mockRejectedValue(new Error("connection reset"));
      const replicaClient = { user: { findMany } };
      const query = vi.fn().mockResolvedValue([{ id: "primary-result" }]);

      const result = await routeToReplica({
        model: "User",
        operation: "findMany",
        args: {},
        query,
        decision: { target: "replica", replicaId: "replica-0", reason: "test" },
        router,
        resolveReplicaClient: () => replicaClient as never,
      });

      expect(result).toEqual([{ id: "primary-result" }]);
      expect(query).toHaveBeenCalledWith({});
      expect(recordFailure).toHaveBeenCalledWith("replica-0", "connection reset");
    });

    it("falls back to the primary when the replica client has no matching delegate method", async () => {
      const router = buildRouter();
      const query = vi.fn().mockResolvedValue("primary-fallback");

      const result = await routeToReplica({
        model: "User",
        operation: "findMany",
        args: {},
        query,
        decision: { target: "replica", replicaId: "replica-0", reason: "test" },
        router,
        resolveReplicaClient: () => ({}) as never,
      });

      expect(result).toBe("primary-fallback");
      expect(query).toHaveBeenCalled();
    });

    it("falls back to the primary when resolveReplicaClient itself throws", async () => {
      const router = buildRouter();
      const query = vi.fn().mockResolvedValue("primary-fallback");

      const result = await routeToReplica({
        model: "User",
        operation: "findMany",
        args: {},
        query,
        decision: { target: "replica", replicaId: "replica-0", reason: "test" },
        router,
        resolveReplicaClient: () => {
          throw new Error("no client configured");
        },
      });

      expect(result).toBe("primary-fallback");
    });
  });
});
