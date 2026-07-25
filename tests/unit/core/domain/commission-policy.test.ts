import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMISSION_RATES,
  calculateCommissionBreakdown,
} from "@/domain/services/commission-policy";

describe("commission-policy", () => {
  it("charges the customer 7.5% of labor only", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.customerPlatformFee).toBe(75);
  });

  it("charges the professional 7.5% commission of labor only", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.professionalCommission).toBe(75);
  });

  it("computes the commission base as labor only — the module spec's own worked example", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(1000);
    expect(breakdown.commissionBase).not.toBe(1500);
  });

  it("never lets materials contribute to the commission base, even when materials dwarf labor", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 2000,
      materialsSubtotal: 10000,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(2000);
    expect(breakdown.customerPlatformFee).toBe(150);
    expect(breakdown.professionalCommission).toBe(150);
  });

  it("materials contribute exactly 0 to both fees regardless of amount", () => {
    const small = calculateCommissionBreakdown({
      laborSubtotal: 100,
      materialsSubtotal: 1,
      rates: DEFAULT_COMMISSION_RATES,
    });
    const large = calculateCommissionBreakdown({
      laborSubtotal: 100,
      materialsSubtotal: 999999,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(small.customerPlatformFee).toBe(large.customerPlatformFee);
    expect(small.professionalCommission).toBe(large.professionalCommission);
  });

  it("handles zero labor — a materials-only quote produces zero commission", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 0,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(0);
    expect(breakdown.customerPlatformFee).toBe(0);
    expect(breakdown.professionalCommission).toBe(0);
    expect(breakdown.professionalNetLaborEarnings).toBe(0);
  });

  it("handles zero materials", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 0,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.materialsSubtotal).toBe(0);
    expect(breakdown.professionalTotalNetEarnings).toBe(breakdown.professionalNetLaborEarnings);
  });

  it("handles large labor amounts without precision drift", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 987654.32,
      materialsSubtotal: 12345.67,
      rates: DEFAULT_COMMISSION_RATES,
    });
    // 987654.32 * 0.075 = 74074.074 -> rounds to 74074.07
    expect(breakdown.customerPlatformFee).toBe(74074.07);
    expect(breakdown.professionalCommission).toBe(74074.07);
  });

  it("rounds to whole cents deterministically (no floating-point drift)", () => {
    const input = { laborSubtotal: 33.33, materialsSubtotal: 0, rates: DEFAULT_COMMISSION_RATES };
    const first = calculateCommissionBreakdown(input);
    const second = calculateCommissionBreakdown(input);
    expect(first).toEqual(second);
    // 33.33 * 0.075 = 2.49975 -> rounds to 2.50
    expect(first.customerPlatformFee).toBe(2.5);
  });

  it("is a pure, deterministic function — same input always produces the same output", () => {
    const input = { laborSubtotal: 1234.56, materialsSubtotal: 78.9, rates: DEFAULT_COMMISSION_RATES };
    const results = Array.from({ length: 5 }, () => calculateCommissionBreakdown(input));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("supports configurable rates — a rate change never requires touching this function", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 0,
      rates: { customerPlatformFeeRateBps: 1000, professionalCommissionRateBps: 500 },
    });
    expect(breakdown.customerPlatformFee).toBe(100);
    expect(breakdown.professionalCommission).toBe(50);
  });

  it("computes professionalNetLaborEarnings as labor minus the professional's own commission", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.professionalNetLaborEarnings).toBe(925);
    expect(breakdown.professionalTotalNetEarnings).toBe(1425);
  });

  it("computes platformGrossRevenue as the sum of both fees", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.platformGrossRevenue).toBe(150);
  });

  it("computes customerTotalPayable as labor + materials + the customer's fee", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.customerTotalPayable).toBe(1575);
  });

  it("rejects a negative labor subtotal rather than silently producing a negative commission", () => {
    expect(() =>
      calculateCommissionBreakdown({ laborSubtotal: -1, materialsSubtotal: 0, rates: DEFAULT_COMMISSION_RATES }),
    ).toThrow();
  });
});
