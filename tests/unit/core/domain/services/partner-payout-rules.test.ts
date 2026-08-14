import { describe, expect, it } from "vitest";

import { DEFAULT_MINIMUM_PAYOUT_THRESHOLD, isEligibleForPayout, selectPayoutBatch } from "@/domain/services/partner-payout-rules";

describe("Module 61 — partner-payout-rules", () => {
  it("is eligible once the approved total reaches the threshold", () => {
    expect(isEligibleForPayout(50, 50)).toBe(true);
    expect(isEligibleForPayout(49.99, 50)).toBe(false);
    expect(isEligibleForPayout(100, 50)).toBe(true);
  });

  it("is never eligible for a zero or negative total", () => {
    expect(isEligibleForPayout(0, 50)).toBe(false);
    expect(isEligibleForPayout(-10, 50)).toBe(false);
  });

  it("exposes a sensible default threshold", () => {
    expect(DEFAULT_MINIMUM_PAYOUT_THRESHOLD).toBeGreaterThan(0);
  });

  it("selects every approved commission into a single batch when eligible", () => {
    const commissions = [
      { id: "c1", affiliateAmount: 20 },
      { id: "c2", affiliateAmount: 35 },
    ];
    const batch = selectPayoutBatch(commissions, 50);
    expect(batch).not.toBeNull();
    expect(batch!.amount).toBe(55);
    expect(batch!.commissionIds).toEqual(["c1", "c2"]);
  });

  it("returns null when the batch total is below the threshold", () => {
    const commissions = [{ id: "c1", affiliateAmount: 10 }];
    expect(selectPayoutBatch(commissions, 50)).toBeNull();
  });

  it("returns null for an empty commission list", () => {
    expect(selectPayoutBatch([], 50)).toBeNull();
  });
});
