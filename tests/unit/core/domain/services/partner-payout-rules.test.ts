import { describe, expect, it } from "vitest";

import { DEFAULT_MINIMUM_PAYOUT_THRESHOLD, isEligibleForPayout, netPayableAmount, selectPayoutBatch } from "@/domain/services/partner-payout-rules";

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
      { id: "c1", affiliateAmount: 20, reversedAmount: 0 },
      { id: "c2", affiliateAmount: 35, reversedAmount: 0 },
    ];
    const batch = selectPayoutBatch(commissions, 50);
    expect(batch).not.toBeNull();
    expect(batch!.amount).toBe(55);
    expect(batch!.commissionIds).toEqual(["c1", "c2"]);
  });

  it("returns null when the batch total is below the threshold", () => {
    const commissions = [{ id: "c1", affiliateAmount: 10, reversedAmount: 0 }];
    expect(selectPayoutBatch(commissions, 50)).toBeNull();
  });

  it("returns null for an empty commission list", () => {
    expect(selectPayoutBatch([], 50)).toBeNull();
  });

  // Module 100 — Affiliate Accumulated Balance & €50 Payout: a commission
  // partially reversed (a partial refund) but still APPROVED must only
  // contribute its NET remaining value to a payout batch, never its
  // original gross affiliateAmount — see module spec §17.
  describe("netPayableAmount", () => {
    it("is the gross amount when nothing has been reversed", () => {
      expect(netPayableAmount({ affiliateAmount: 20, reversedAmount: 0 })).toBe(20);
    });

    it("nets out a partial reversal", () => {
      expect(netPayableAmount({ affiliateAmount: 20, reversedAmount: 8 })).toBe(12);
    });

    it("never goes negative even if reversedAmount somehow exceeds affiliateAmount", () => {
      expect(netPayableAmount({ affiliateAmount: 20, reversedAmount: 25 })).toBe(0);
    });
  });

  describe("selectPayoutBatch with partial reversals", () => {
    it("excludes the already-reversed portion of a partially-refunded commission from the payout amount", () => {
      // €70 gross approved across two commissions, but €10 of commission
      // c1 has already been reversed by a partial refund — the payout
      // must settle exactly €60 net (module spec §17's exact scenario:
      // the reversed portion is never withdrawable), never the stale €70
      // gross total.
      const commissions = [
        { id: "c1", affiliateAmount: 50, reversedAmount: 10 },
        { id: "c2", affiliateAmount: 20, reversedAmount: 0 },
      ];
      const batch = selectPayoutBatch(commissions, 50);
      expect(batch).not.toBeNull();
      expect(batch!.amount).toBe(60);
    });

    it("returns null when the net (post-reversal) total falls below the threshold even though the gross total does not", () => {
      const commissions = [{ id: "c1", affiliateAmount: 60, reversedAmount: 15 }];
      // net = 45, below the 50 threshold, even though gross (60) is above it
      expect(selectPayoutBatch(commissions, 50)).toBeNull();
    });
  });
});
