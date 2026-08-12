import { describe, expect, it } from "vitest";

import { permitsReplicaRead, type ReadConsistencyPolicy } from "@/domain/services/read-consistency-policy";

describe("domain/services/read-consistency-policy", () => {
  describe("permitsReplicaRead", () => {
    it("STRONG never permits a replica, regardless of lag", () => {
      const policy: ReadConsistencyPolicy = { level: "STRONG", maxStalenessMs: 0 };
      expect(permitsReplicaRead(policy, null)).toBe(false);
      expect(permitsReplicaRead(policy, 0)).toBe(false);
      expect(permitsReplicaRead(policy, 999_999)).toBe(false);
    });

    it("EVENTUAL always permits a replica, regardless of lag", () => {
      const policy: ReadConsistencyPolicy = { level: "EVENTUAL", maxStalenessMs: 0 };
      expect(permitsReplicaRead(policy, null)).toBe(true);
      expect(permitsReplicaRead(policy, 0)).toBe(true);
      expect(permitsReplicaRead(policy, 999_999)).toBe(true);
    });

    describe("BOUNDED_STALENESS", () => {
      const policy: ReadConsistencyPolicy = { level: "BOUNDED_STALENESS", maxStalenessMs: 5000 };

      it("permits a replica whose lag is within the bound", () => {
        expect(permitsReplicaRead(policy, 0)).toBe(true);
        expect(permitsReplicaRead(policy, 5000)).toBe(true);
      });

      it("rejects a replica whose lag exceeds the bound", () => {
        expect(permitsReplicaRead(policy, 5001)).toBe(false);
      });

      it("rejects an unmeasured (null) lag — cannot be shown to be within any bound", () => {
        expect(permitsReplicaRead(policy, null)).toBe(false);
      });
    });
  });
});
