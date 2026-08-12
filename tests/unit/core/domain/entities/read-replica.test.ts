import { describe, expect, it } from "vitest";

import { ReplicaHealth, ReplicationLag, type ReplicaHealthThresholds } from "@/domain/entities/read-replica";

const THRESHOLDS: ReplicaHealthThresholds = { failureThreshold: 3, recoveryThreshold: 2, maxLagMs: 30_000 };

describe("domain/entities/read-replica", () => {
  describe("ReplicationLag", () => {
    it("rejects a negative or non-finite value", () => {
      expect(() => new ReplicationLag(-1)).toThrow(RangeError);
      expect(() => new ReplicationLag(Number.NaN)).toThrow(RangeError);
      expect(() => new ReplicationLag(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it("exceeds() compares strictly greater than the threshold", () => {
      expect(new ReplicationLag(100).exceeds(100)).toBe(false);
      expect(new ReplicationLag(101).exceeds(100)).toBe(true);
      expect(new ReplicationLag(0).exceeds(0)).toBe(false);
    });
  });

  describe("ReplicaHealth", () => {
    it("starts UNKNOWN and ineligible", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      expect(health.state).toBe("UNKNOWN");
      expect(health.isEligible(new Date(), null)).toBe(false);
    });

    it("moves UNKNOWN -> HEALTHY on the first success", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, null, new Date());
      expect(health.state).toBe("HEALTHY");
      expect(health.isEligible(new Date(), null)).toBe(true);
    });

    it("moves HEALTHY -> DEGRADED on a single failure, without tripping the breaker", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, null, new Date());
      health.recordFailure("timeout", new Date());
      expect(health.state).toBe("DEGRADED");
      expect(health.isEligible(new Date(), null)).toBe(true);
    });

    it("trips to UNHEALTHY after reaching the failure threshold", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, null, new Date());
      health.recordFailure("e1", new Date());
      health.recordFailure("e2", new Date());
      health.recordFailure("e3", new Date());
      expect(health.state).toBe("UNHEALTHY");
      expect(health.isEligible(new Date(), null)).toBe(false);
    });

    it("a single success mid-streak resets the failure counter", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, null, new Date());
      health.recordFailure("e1", new Date());
      health.recordFailure("e2", new Date());
      health.recordSuccess(5, null, new Date());
      health.recordFailure("e3", new Date());
      expect(health.state).not.toBe("UNHEALTHY");
    });

    it("requires recoveryThreshold consecutive successes to leave UNHEALTHY", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, null, new Date());
      health.recordFailure("e1", new Date());
      health.recordFailure("e2", new Date());
      health.recordFailure("e3", new Date());
      expect(health.state).toBe("UNHEALTHY");

      health.recordSuccess(5, null, new Date());
      expect(health.state).toBe("UNHEALTHY");
      health.recordSuccess(5, null, new Date());
      expect(health.state).toBe("HEALTHY");
    });

    it("a lag reading exceeding maxLagMs trips to UNHEALTHY even on success", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, new ReplicationLag(60_000), new Date());
      expect(health.state).toBe("UNHEALTHY");
      expect(health.lastLagMs).toBe(60_000);
    });

    it("an undefined lag on a passive success preserves the previously recorded lag reading", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, new ReplicationLag(1000), new Date());
      expect(health.lastLagMs).toBe(1000);

      health.recordSuccess(5, undefined, new Date());
      expect(health.lastLagMs).toBe(1000);
      expect(health.state).toBe("HEALTHY");
    });

    it("a null lag explicitly clears the previously recorded lag reading", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordSuccess(5, new ReplicationLag(1000), new Date());
      health.recordSuccess(5, null, new Date());
      expect(health.lastLagMs).toBeNull();
    });

    it("isEligible() excludes a stale signal when maxStaleAgeMs is set", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      const checkedAt = new Date("2026-01-01T00:00:00Z");
      health.recordSuccess(5, null, checkedAt);

      expect(health.isEligible(new Date("2026-01-01T00:00:05Z"), 10_000)).toBe(true);
      expect(health.isEligible(new Date("2026-01-01T00:00:15Z"), 10_000)).toBe(false);
    });

    it("toSnapshot() reflects the current bookkeeping", () => {
      const health = new ReplicaHealth("replica-0", THRESHOLDS);
      health.recordFailure("boom", new Date("2026-01-01T00:00:00Z"));

      const snapshot = health.toSnapshot();
      expect(snapshot).toMatchObject({
        replicaId: "replica-0",
        state: "DEGRADED",
        consecutiveFailures: 1,
        consecutiveSuccesses: 0,
        lastError: "boom",
      });
    });
  });
});
