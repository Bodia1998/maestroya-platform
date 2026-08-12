import { describe, expect, it } from "vitest";

import {
  createReplicaSelector,
  LeastLagReplicaSelector,
  RandomReplicaSelector,
  type ReplicaCandidate,
  RoundRobinReplicaSelector,
} from "@/domain/services/replica-selector";

const CANDIDATES: ReplicaCandidate[] = [
  { replicaId: "replica-0", lagMs: 200 },
  { replicaId: "replica-1", lagMs: 50 },
  { replicaId: "replica-2", lagMs: null },
];

describe("domain/services/replica-selector", () => {
  describe("RoundRobinReplicaSelector", () => {
    it("returns null for an empty candidate list", () => {
      expect(new RoundRobinReplicaSelector().select([])).toBeNull();
    });

    it("cycles through candidates in order, wrapping around", () => {
      const selector = new RoundRobinReplicaSelector();
      expect(selector.select(CANDIDATES)).toBe("replica-0");
      expect(selector.select(CANDIDATES)).toBe("replica-1");
      expect(selector.select(CANDIDATES)).toBe("replica-2");
      expect(selector.select(CANDIDATES)).toBe("replica-0");
    });

    it("advances relative to whatever list is passed in, even when it shrinks between calls", () => {
      const selector = new RoundRobinReplicaSelector();
      expect(selector.select(CANDIDATES)).toBe("replica-0");
      expect(selector.select(CANDIDATES.slice(0, 2))).toBe("replica-1");
    });
  });

  describe("RandomReplicaSelector", () => {
    it("returns null for an empty candidate list", () => {
      expect(new RandomReplicaSelector(() => 0).select([])).toBeNull();
    });

    it("uses the injected random function deterministically", () => {
      expect(new RandomReplicaSelector(() => 0).select(CANDIDATES)).toBe("replica-0");
      expect(new RandomReplicaSelector(() => 0.5).select(CANDIDATES)).toBe("replica-1");
      // A random() value arbitrarily close to 1 must still resolve to the
      // last candidate, never index out of bounds.
      expect(new RandomReplicaSelector(() => 0.9999).select(CANDIDATES)).toBe("replica-2");
    });
  });

  describe("LeastLagReplicaSelector", () => {
    it("returns null for an empty candidate list", () => {
      expect(new LeastLagReplicaSelector().select([])).toBeNull();
    });

    it("picks the candidate with the lowest lag", () => {
      expect(new LeastLagReplicaSelector().select(CANDIDATES)).toBe("replica-1");
    });

    it("treats a null lag as worse than any measured value", () => {
      const candidates: ReplicaCandidate[] = [
        { replicaId: "replica-a", lagMs: null },
        { replicaId: "replica-b", lagMs: 10_000 },
      ];
      expect(new LeastLagReplicaSelector().select(candidates)).toBe("replica-b");
    });

    it("breaks ties (including all-null) by picking the first candidate given", () => {
      const candidates: ReplicaCandidate[] = [
        { replicaId: "replica-a", lagMs: null },
        { replicaId: "replica-b", lagMs: null },
      ];
      expect(new LeastLagReplicaSelector().select(candidates)).toBe("replica-a");
    });
  });

  describe("createReplicaSelector", () => {
    it("builds the selector matching each strategy name", () => {
      expect(createReplicaSelector("ROUND_ROBIN")).toBeInstanceOf(RoundRobinReplicaSelector);
      expect(createReplicaSelector("RANDOM")).toBeInstanceOf(RandomReplicaSelector);
      expect(createReplicaSelector("LEAST_LAG")).toBeInstanceOf(LeastLagReplicaSelector);
    });
  });
});
