import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMISSION_RATES,
  calculateCommissionBreakdown,
} from "@/domain/services/commission-policy";

describe("commission-policy (Module 64 — thin adapter over CommissionCalculationService)", () => {
  it("charges a flat 10% commission on the TOTAL (labour + materials), the module's own worked example", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 5000,
      materialsSubtotal: 1000,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(6000);
    expect(breakdown.commission).toBe(600);
    expect(breakdown.professionalPayout).toBe(5400);
  });

  it("computes the commission base as labour + materials, never labour alone", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(1500);
    expect(breakdown.commission).toBe(150);
  });

  it("lets materials contribute to the commission exactly like labour, even when materials dwarf labour", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 2000,
      materialsSubtotal: 10000,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(12000);
    expect(breakdown.commission).toBe(1200);
    expect(breakdown.professionalPayout).toBe(10800);
  });

  it("handles zero labour — a materials-only quote still produces a commission", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 0,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(500);
    expect(breakdown.commission).toBe(50);
    expect(breakdown.professionalPayout).toBe(450);
  });

  it("handles zero materials — a labour-only quote", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 0,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.materialsSubtotal).toBe(0);
    expect(breakdown.commissionBase).toBe(1000);
    expect(breakdown.commission).toBe(100);
    expect(breakdown.professionalPayout).toBe(900);
  });

  it("handles an all-zero quote without error", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 0,
      materialsSubtotal: 0,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.commissionBase).toBe(0);
    expect(breakdown.commission).toBe(0);
    expect(breakdown.professionalPayout).toBe(0);
  });

  it("handles large amounts without precision drift", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 987654.32,
      materialsSubtotal: 12345.67,
      rates: DEFAULT_COMMISSION_RATES,
    });
    // (987654.32 + 12345.67) * 0.10 = 999999.99 * 0.10 = 99999.999 -> 100000.00
    expect(breakdown.commissionBase).toBe(999999.99);
    expect(breakdown.commission).toBe(100000);
  });

  it("rounds to whole cents deterministically (no floating-point drift)", () => {
    const input = { laborSubtotal: 33.33, materialsSubtotal: 0, rates: DEFAULT_COMMISSION_RATES };
    const first = calculateCommissionBreakdown(input);
    const second = calculateCommissionBreakdown(input);
    expect(first).toEqual(second);
    // 33.33 * 0.10 = 3.333 -> rounds to 3.33
    expect(first.commission).toBe(3.33);
  });

  it("is a pure, deterministic function — same input always produces the same output", () => {
    const input = { laborSubtotal: 1234.56, materialsSubtotal: 78.9, rates: DEFAULT_COMMISSION_RATES };
    const results = Array.from({ length: 5 }, () => calculateCommissionBreakdown(input));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("supports a configurable rate — a rate change never requires touching this function", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 0,
      rates: { commissionRateBps: 500 },
    });
    expect(breakdown.commission).toBe(50);
  });

  it("computes platformGrossRevenue as exactly the flat commission", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.platformGrossRevenue).toBe(breakdown.commission);
    expect(breakdown.platformGrossRevenue).toBe(150);
  });

  it("computes customerTotalPayable as exactly labour + materials — no fee added on top", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(breakdown.customerTotalPayable).toBe(1500);
    expect(breakdown.customerTotalPayable).toBe(breakdown.commissionBase);
  });

  it("never leaves the removed dual-fee fields on the returned object", () => {
    const breakdown = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 500,
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(Object.keys(breakdown)).not.toContain("customerPlatformFee");
    expect(Object.keys(breakdown)).not.toContain("professionalCommission");
    expect(Object.keys(breakdown)).not.toContain("professionalNetLaborEarnings");
    expect(Object.keys(breakdown)).not.toContain("professionalTotalNetEarnings");
  });

  it("rejects a negative labour subtotal rather than silently producing a negative commission", () => {
    expect(() =>
      calculateCommissionBreakdown({ laborSubtotal: -1, materialsSubtotal: 0, rates: DEFAULT_COMMISSION_RATES }),
    ).toThrow();
  });

  it("rejects a negative materials subtotal", () => {
    expect(() =>
      calculateCommissionBreakdown({ laborSubtotal: 0, materialsSubtotal: -1, rates: DEFAULT_COMMISSION_RATES }),
    ).toThrow();
  });
});
