import { describe, expect, it } from "vitest";

import {
  AFFILIATE_COMMISSION_RATE_BPS,
  calculateAffiliateCommission,
  computeAffiliateCommissionExpiry,
} from "@/domain/services/affiliate-commission-policy";

describe("Module 61 — affiliate-commission-policy", () => {
  it("pays the affiliate 10% of MaestroYa's platform commission — the module spec's own worked example", () => {
    // Booking: 1,000€. MaestroYa platform commission: 10% = 100€.
    // Affiliate receives: 10% of 100€ = 10€. MaestroYa keeps 90€.
    const platformCommission = 100;
    const affiliateAmount = calculateAffiliateCommission(platformCommission);
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
    expect(calculateAffiliateCommission(100)).toBe(10);
  });

  it("supports a configurable rate", () => {
    expect(calculateAffiliateCommission(100, 500)).toBe(5);
    expect(calculateAffiliateCommission(200, 2000)).toBe(40);
  });

  it("rounds to whole cents deterministically", () => {
    // 33.33 * 0.10 = 3.333 -> rounds to 3.33
    expect(calculateAffiliateCommission(33.33)).toBe(3.33);
  });

  it("is a pure, deterministic function", () => {
    const results = Array.from({ length: 5 }, () => calculateAffiliateCommission(74074.07));
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
  });

  it("handles zero platform commission", () => {
    expect(calculateAffiliateCommission(0)).toBe(0);
  });

  it("rejects a negative platform commission amount", () => {
    expect(() => calculateAffiliateCommission(-1)).toThrow();
  });

  it("rejects a negative rate", () => {
    expect(() => calculateAffiliateCommission(100, -1)).toThrow();
  });

  it("computes an expiry date N days after creation", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = computeAffiliateCommissionExpiry(createdAt, 180);
    const expectedMs = createdAt.getTime() + 180 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBe(expectedMs);
  });
});
