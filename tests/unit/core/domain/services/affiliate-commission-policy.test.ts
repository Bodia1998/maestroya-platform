import { describe, expect, it } from "vitest";

import {
  AFFILIATE_COMMISSION_RATE_BPS,
  calculateAffiliateCommission,
  calculateAffiliateCommissionFeeCorrection,
  calculateAffiliateCommissionReversal,
  computeAffiliateCommissionExpiry,
} from "@/domain/services/affiliate-commission-policy";

describe("Module 61/96 — affiliate-commission-policy", () => {
  it("pays the affiliate 10% of MaestroYa's platform commission when no attributable cost is known — the module spec's own worked example", () => {
    // Booking: 1,000€. MaestroYa platform commission: 10% = 100€.
    // No attributable cost known -> profit base = 100€.
    // Affiliate receives: 10% of 100€ = 10€. MaestroYa keeps 90€.
    const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({ platformCommissionAmount: 100 });
    expect(profitBaseAmount).toBe(100);
    expect(affiliateAmount).toBe(10);
  });

  it("defaults to AFFILIATE_COMMISSION_RATE_BPS (10%)", () => {
    expect(AFFILIATE_COMMISSION_RATE_BPS).toBe(1000);
  });

  it("never treats the input as a booking value — a much larger booking with the same platform commission produces the same affiliate amount", () => {
    // A 1,000€ booking and a 50,000€ booking could both, hypothetically,
    // produce the same 100€ platform commission (different rate structures
    // per module) — this function must only ever look at the commission
    // amount it's handed, never re-derive anything from a booking value it
    // was never even given.
    expect(calculateAffiliateCommission({ platformCommissionAmount: 100 }).affiliateAmount).toBe(10);
  });

  it("supports a configurable rate", () => {
    expect(calculateAffiliateCommission({ platformCommissionAmount: 100, rateBps: 500 }).affiliateAmount).toBe(5);
    expect(calculateAffiliateCommission({ platformCommissionAmount: 200, rateBps: 2000 }).affiliateAmount).toBe(40);
  });

  it("rounds to whole cents deterministically", () => {
    // 33.33 * 0.10 = 3.333 -> rounds to 3.33
    expect(calculateAffiliateCommission({ platformCommissionAmount: 33.33 }).affiliateAmount).toBe(3.33);
  });

  it("is a pure, deterministic function", () => {
    const results = Array.from({ length: 5 }, () => calculateAffiliateCommission({ platformCommissionAmount: 74074.07 }));
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
  });

  it("handles zero platform commission", () => {
    const result = calculateAffiliateCommission({ platformCommissionAmount: 0 });
    expect(result.profitBaseAmount).toBe(0);
    expect(result.affiliateAmount).toBe(0);
  });

  it("rejects a negative platform commission amount", () => {
    expect(() => calculateAffiliateCommission({ platformCommissionAmount: -1 })).toThrow();
  });

  it("rejects a negative rate", () => {
    expect(() => calculateAffiliateCommission({ platformCommissionAmount: 100, rateBps: -1 })).toThrow();
  });

  it("rejects a negative attributable cost", () => {
    expect(() => calculateAffiliateCommission({ platformCommissionAmount: 100, attributableCostAmount: -1 })).toThrow();
  });

  it("computes an expiry date N days after creation", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeAffiliateCommissionExpiry(createdAt, 180);
    const expectedMs = createdAt.getTime() + 180 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBe(expectedMs);
  });

  describe("Module 96 — profit base, not gross commission", () => {
    it("€1000 platform commission, €150 attributable cost -> €850 profit base -> €85 affiliate reward, NOT €100 (10% of gross)", () => {
      const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
        platformCommissionAmount: 1000,
        attributableCostAmount: 150,
      });
      expect(profitBaseAmount).toBe(850);
      expect(affiliateAmount).toBe(85);
      // The regression this test exists to prevent: blindly taking 10% of
      // the gross platform commission would have produced 100, not 85.
      expect(affiliateAmount).not.toBe(roundToTen(1000));
    });

    it("scenario A — €500 txn / €50 platform commission / €5 attributable cost -> €45 profit base -> €4.50 reward", () => {
      const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
        platformCommissionAmount: 50,
        attributableCostAmount: 5,
      });
      expect(profitBaseAmount).toBe(45);
      expect(affiliateAmount).toBe(4.5);
    });

    it("scenario B — €1200 txn / €120 platform commission / €12 attributable cost -> €108 profit base -> €10.80 reward", () => {
      const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
        platformCommissionAmount: 120,
        attributableCostAmount: 12,
      });
      expect(profitBaseAmount).toBe(108);
      expect(affiliateAmount).toBe(10.8);
    });

    it("scenario C (spec's own worked example) — €1000 commission, €150 attributable cost, €850 profit base, €85 reward", () => {
      const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
        platformCommissionAmount: 1000,
        attributableCostAmount: 150,
      });
      expect(profitBaseAmount).toBe(850);
      expect(affiliateAmount).toBe(85);
    });

    it("Module 96 real-fee scenario — €1000 payment, €100 platform commission, €15 actual Stripe fee -> €85 profit base -> €8.50 reward", () => {
      const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
        platformCommissionAmount: 100,
        attributableCostAmount: 15,
      });
      expect(profitBaseAmount).toBe(85);
      expect(affiliateAmount).toBe(8.5);
      // Never 10% of the gross €100 commission (would be €10) — the whole
      // point of the profit-base fix.
      expect(affiliateAmount).not.toBe(10);
    });

    it("floors the profit base at 0 when attributable cost exceeds the platform commission — never a negative profit base, never a negative reward", () => {
      const { profitBaseAmount, affiliateAmount } = calculateAffiliateCommission({
        platformCommissionAmount: 20,
        attributableCostAmount: 35,
      });
      expect(profitBaseAmount).toBe(0);
      expect(affiliateAmount).toBe(0);
    });

    it("attributableCostAmount defaults to 0 when omitted, matching gross-commission behavior only in that degenerate case", () => {
      const withDefault = calculateAffiliateCommission({ platformCommissionAmount: 100 });
      const explicitZero = calculateAffiliateCommission({ platformCommissionAmount: 100, attributableCostAmount: 0 });
      expect(withDefault).toEqual(explicitZero);
    });
  });

  describe("Module 96 — calculateAffiliateCommissionReversal", () => {
    it("full refund reverses whatever remains unreversed, bringing the net balance to exactly 0", () => {
      const reversal = calculateAffiliateCommissionReversal({
        affiliateAmount: 10,
        alreadyReversedAmount: 0,
        refundedAmount: 1000,
        paymentAmount: 1000,
        isFullRefund: true,
      });
      expect(reversal).toBe(10);
    });

    it("full refund after a prior partial reversal only reverses the remainder, never double-reverses", () => {
      const reversal = calculateAffiliateCommissionReversal({
        affiliateAmount: 10,
        alreadyReversedAmount: 4,
        refundedAmount: 1000,
        paymentAmount: 1000,
        isFullRefund: true,
      });
      expect(reversal).toBe(6);
    });

    it("partial refund reverses the same proportion of the affiliate commission as was refunded of the payment", () => {
      // 30% of a 1000€ payment refunded -> 30% of a 10€ commission reversed.
      const reversal = calculateAffiliateCommissionReversal({
        affiliateAmount: 10,
        alreadyReversedAmount: 0,
        refundedAmount: 300,
        paymentAmount: 1000,
        isFullRefund: false,
      });
      expect(reversal).toBe(3);
    });

    it("caps a partial reversal so cumulative reversals never exceed the original affiliateAmount", () => {
      const reversal = calculateAffiliateCommissionReversal({
        affiliateAmount: 10,
        alreadyReversedAmount: 9,
        refundedAmount: 500,
        paymentAmount: 1000,
        isFullRefund: false,
      });
      // 50% of 10 = 5, but only 1 remains unreversed.
      expect(reversal).toBe(1);
    });

    it("a zero-amount payment never divides by zero", () => {
      const reversal = calculateAffiliateCommissionReversal({
        affiliateAmount: 10,
        alreadyReversedAmount: 0,
        refundedAmount: 0,
        paymentAmount: 0,
        isFullRefund: false,
      });
      expect(reversal).toBe(0);
    });

    it("is a pure, deterministic function", () => {
      const results = Array.from({ length: 5 }, () =>
        calculateAffiliateCommissionReversal({
          affiliateAmount: 8.5,
          alreadyReversedAmount: 0,
          refundedAmount: 150,
          paymentAmount: 1000,
          isFullRefund: false,
        }),
      );
      for (const r of results) {
        expect(r).toEqual(results[0]);
      }
    });
  });

  describe("Module 96 Financial Fix Pass — calculateAffiliateCommissionFeeCorrection", () => {
    it("the exact worked scenario: €1000 booking, €100 commission, €15 real fee arriving late — corrects €10 down to €8.50, a €1.50 reversal", () => {
      const result = calculateAffiliateCommissionFeeCorrection({
        platformCommissionAmount: 100,
        affiliateAmount: 10,
        actualAttributableCostAmount: 15,
        alreadyReversedAmount: 0,
        rateBps: AFFILIATE_COMMISSION_RATE_BPS,
      });
      expect(result.correctedProfitBaseAmount).toBe(85);
      expect(result.correctedAffiliateAmount).toBe(8.5);
      expect(result.reversalAmount).toBe(1.5);
    });

    it("a genuinely zero real fee produces zero correction", () => {
      const result = calculateAffiliateCommissionFeeCorrection({
        platformCommissionAmount: 100,
        affiliateAmount: 10,
        actualAttributableCostAmount: 0,
        alreadyReversedAmount: 0,
        rateBps: AFFILIATE_COMMISSION_RATE_BPS,
      });
      expect(result.reversalAmount).toBe(0);
    });

    it("caps the reversal so cumulative reversals (fee correction + prior refund reversal) never exceed affiliateAmount", () => {
      const result = calculateAffiliateCommissionFeeCorrection({
        platformCommissionAmount: 100,
        affiliateAmount: 10,
        actualAttributableCostAmount: 100, // extreme: fee consumes the whole commission
        alreadyReversedAmount: 9, // 9 already clawed back by an earlier refund
        rateBps: AFFILIATE_COMMISSION_RATE_BPS,
      });
      // Uncapped delta would be 10 - 0 = 10, but only 1 remains unreversed.
      expect(result.reversalAmount).toBe(1);
    });

    it("never produces a negative reversal even if actualAttributableCostAmount is somehow less than what cost=0 already assumed", () => {
      const result = calculateAffiliateCommissionFeeCorrection({
        platformCommissionAmount: 100,
        affiliateAmount: 10,
        actualAttributableCostAmount: 0,
        alreadyReversedAmount: 0,
        rateBps: AFFILIATE_COMMISSION_RATE_BPS,
      });
      expect(result.reversalAmount).toBeGreaterThanOrEqual(0);
    });

    it("is a pure, deterministic function", () => {
      const input = {
        platformCommissionAmount: 250,
        affiliateAmount: 25,
        actualAttributableCostAmount: 12.34,
        alreadyReversedAmount: 0,
        rateBps: AFFILIATE_COMMISSION_RATE_BPS,
      };
      const results = Array.from({ length: 5 }, () => calculateAffiliateCommissionFeeCorrection(input));
      for (const r of results) {
        expect(r).toEqual(results[0]);
      }
    });
  });
});

function roundToTen(commission: number): number {
  return commission * 0.1;
}
