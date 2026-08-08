import { describe, expect, it } from "vitest";

import { hashToBucket, isInRolloutPercentage, pickVariant } from "@/domain/services/feature-flag-rollout";

describe("domain/services/feature-flag-rollout", () => {
  describe("hashToBucket", () => {
    it("is deterministic for the same inputs", () => {
      const a = hashToBucket("my-flag", "rollout", "user-123");
      const b = hashToBucket("my-flag", "rollout", "user-123");
      expect(a).toBe(b);
    });

    it("differs across flag keys for the same user (no cross-flag correlation)", () => {
      const bucketsAreIdentical = Array.from({ length: 20 }, (_, i) => `user-${i}`).every(
        (userId) => hashToBucket("flag-a", "rollout", userId) === hashToBucket("flag-b", "rollout", userId),
      );
      expect(bucketsAreIdentical).toBe(false);
    });

    it("differs across salts for the same flag/user (rollout vs. variant independence)", () => {
      const bucketsAreIdentical = Array.from({ length: 20 }, (_, i) => `user-${i}`).every(
        (userId) => hashToBucket("flag-a", "rollout", userId) === hashToBucket("flag-a", "variant", userId),
      );
      expect(bucketsAreIdentical).toBe(false);
    });

    it("always returns a bucket within [0, 10_000)", () => {
      for (let i = 0; i < 200; i += 1) {
        const bucket = hashToBucket("flag", "rollout", `user-${i}`);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(10_000);
      }
    });
  });

  describe("isInRolloutPercentage", () => {
    it("is deterministic — the same user always gets the same answer", () => {
      const results = Array.from({ length: 5 }, () => isInRolloutPercentage("flag", "user-42", 37));
      expect(new Set(results).size).toBe(1);
    });

    it("0% never includes anyone", () => {
      for (let i = 0; i < 100; i += 1) {
        expect(isInRolloutPercentage("flag", `user-${i}`, 0)).toBe(false);
      }
    });

    it("negative percentage never includes anyone", () => {
      expect(isInRolloutPercentage("flag", "user-1", -10)).toBe(false);
    });

    it("100% always includes everyone", () => {
      for (let i = 0; i < 100; i += 1) {
        expect(isInRolloutPercentage("flag", `user-${i}`, 100)).toBe(true);
      }
    });

    it("percentage above 100 is treated as 100%", () => {
      expect(isInRolloutPercentage("flag", "user-1", 150)).toBe(true);
    });

    it("roughly approximates the configured percentage across a large population", () => {
      const total = 20_000;
      let included = 0;
      for (let i = 0; i < total; i += 1) {
        if (isInRolloutPercentage("flag", `user-${i}`, 25)) included += 1;
      }
      const ratio = included / total;
      // Statistical, not exact — allow a generous tolerance band.
      expect(ratio).toBeGreaterThan(0.2);
      expect(ratio).toBeLessThan(0.3);
    });

    it("a user included at a lower percentage stays included as the percentage grows (monotonic rollout)", () => {
      const userId = "sticky-user";
      const includedAt = (pct: number) => isInRolloutPercentage("flag", userId, pct);
      let foundIncludedAt: number | null = null;
      for (let pct = 1; pct <= 100; pct += 1) {
        if (includedAt(pct)) {
          foundIncludedAt = pct;
          break;
        }
      }
      expect(foundIncludedAt).not.toBeNull();
      if (foundIncludedAt !== null) {
        for (let pct = foundIncludedAt; pct <= 100; pct += 1) {
          expect(includedAt(pct)).toBe(true);
        }
      }
    });
  });

  describe("pickVariant", () => {
    it("returns undefined for an empty variant list", () => {
      expect(pickVariant("flag", "user-1", [])).toBeUndefined();
    });

    it("returns undefined when every weight is zero or negative", () => {
      expect(pickVariant("flag", "user-1", [{ name: "a", weight: 0 }, { name: "b", weight: -1 }])).toBeUndefined();
    });

    it("returns the only variant when there is exactly one", () => {
      expect(pickVariant("flag", "user-1", [{ name: "control", weight: 1 }])).toBe("control");
    });

    it("is deterministic for the same user", () => {
      const variants = [
        { name: "control", weight: 50 },
        { name: "treatment", weight: 50 },
      ];
      const first = pickVariant("flag", "user-99", variants);
      const second = pickVariant("flag", "user-99", variants);
      expect(first).toBe(second);
    });

    it("distributes across variants roughly proportional to weight", () => {
      const variants = [
        { name: "control", weight: 1 },
        { name: "treatment", weight: 3 },
      ];
      const counts: Record<string, number> = { control: 0, treatment: 0 };
      const total = 4000;
      for (let i = 0; i < total; i += 1) {
        const variant = pickVariant("flag", `user-${i}`, variants);
        if (variant) counts[variant] = (counts[variant] ?? 0) + 1;
      }
      const treatmentRatio = (counts.treatment ?? 0) / total;
      expect(treatmentRatio).toBeGreaterThan(0.65);
      expect(treatmentRatio).toBeLessThan(0.85);
    });
  });
});
