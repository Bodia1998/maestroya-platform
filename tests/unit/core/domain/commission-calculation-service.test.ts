import { describe, expect, it } from "vitest";

import {
  COMMISSION_CALCULATION_SERVICE,
  CommissionCalculationService,
  DEFAULT_COMMISSION_RATE_BPS,
} from "@/domain/services/commission-calculation-service";

describe("CommissionCalculationService", () => {
  const service = new CommissionCalculationService();

  it("computes the module's own worked example exactly: Labour 5000 + Materials 1000 = Total 6000, Commission 600 (10%), Payout 5400", () => {
    const result = service.calculate({ labour: 5000, materials: 1000 });
    expect(result.labour).toBe(5000);
    expect(result.materials).toBe(1000);
    expect(result.total).toBe(6000);
    expect(result.commissionRateBps).toBe(1000);
    expect(result.commissionPercentage).toBe(10);
    expect(result.commission).toBe(600);
    expect(result.professionalPayout).toBe(5400);
  });

  it("defaults to the platform's 10% flat rate when none is supplied", () => {
    const result = service.calculate({ labour: 100, materials: 0 });
    expect(result.commissionRateBps).toBe(DEFAULT_COMMISSION_RATE_BPS);
    expect(result.commission).toBe(10);
  });

  it("charges commission on the TOTAL, never on labour alone", () => {
    const result = service.calculate({ labour: 100, materials: 100 });
    expect(result.total).toBe(200);
    expect(result.commission).toBe(20);
  });

  it("handles zero labour — materials-only quote still produces a commission", () => {
    const result = service.calculate({ labour: 0, materials: 1000 });
    expect(result.total).toBe(1000);
    expect(result.commission).toBe(100);
    expect(result.professionalPayout).toBe(900);
  });

  it("handles zero materials — labour-only quote", () => {
    const result = service.calculate({ labour: 1000, materials: 0 });
    expect(result.total).toBe(1000);
    expect(result.commission).toBe(100);
    expect(result.professionalPayout).toBe(900);
  });

  it("handles an all-zero quote without error", () => {
    const result = service.calculate({ labour: 0, materials: 0 });
    expect(result.total).toBe(0);
    expect(result.commission).toBe(0);
    expect(result.professionalPayout).toBe(0);
  });

  it("handles materials greater than labour, commission still applies to the combined total", () => {
    const result = service.calculate({ labour: 200, materials: 5000 });
    expect(result.total).toBe(5200);
    expect(result.commission).toBe(520);
    expect(result.professionalPayout).toBe(4680);
  });

  it("handles large numbers without precision drift", () => {
    const result = service.calculate({ labour: 987654.32, materials: 12345.67 });
    expect(result.total).toBe(999999.99);
    expect(result.commission).toBe(100000);
    expect(result.professionalPayout).toBe(899999.99);
  });

  it("rounds to whole cents deterministically (no floating-point drift)", () => {
    const first = service.calculate({ labour: 33.33, materials: 11.11 });
    const second = service.calculate({ labour: 33.33, materials: 11.11 });
    expect(first).toEqual(second);
    // total 44.44 * 0.10 = 4.444 -> 4.44
    expect(first.commission).toBe(4.44);
    expect(first.professionalPayout).toBe(40);
  });

  it("is a pure, deterministic function — same input always produces the same output", () => {
    const input = { labour: 1234.56, materials: 78.9 };
    const results = Array.from({ length: 5 }, () => service.calculate(input));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("commission is always >= 0", () => {
    const result = service.calculate({ labour: 0, materials: 0 });
    expect(result.commission).toBeGreaterThanOrEqual(0);
  });

  it("professionalPayout always equals total - commission", () => {
    const result = service.calculate({ labour: 733.5, materials: 266.75 });
    expect(result.professionalPayout).toBe(Math.round((result.total - result.commission) * 100) / 100);
  });

  it("supports a configurable commission rate rather than hardcoding 10%", () => {
    const result = service.calculate({ labour: 1000, materials: 0, commissionRateBps: 500 });
    expect(result.commissionRateBps).toBe(500);
    expect(result.commissionPercentage).toBe(5);
    expect(result.commission).toBe(50);
    expect(result.professionalPayout).toBe(950);
  });

  it("rejects a negative labour amount", () => {
    expect(() => service.calculate({ labour: -1, materials: 0 })).toThrow();
  });

  it("rejects a negative materials amount", () => {
    expect(() => service.calculate({ labour: 0, materials: -1 })).toThrow();
  });

  it("rejects a negative commission rate", () => {
    expect(() => service.calculate({ labour: 100, materials: 0, commissionRateBps: -1 })).toThrow();
  });

  it("exposes a module-level singleton for callers that don't need their own instance", () => {
    const result = COMMISSION_CALCULATION_SERVICE.calculate({ labour: 100, materials: 0 });
    expect(result.commission).toBe(10);
  });

  it("accepts an empty adjustments array as a no-op (reserved extension point for future VAT/promotions/coupons/affiliate/referral/seasonal campaigns)", () => {
    const result = service.calculate({ labour: 100, materials: 50, adjustments: [] });
    expect(result.total).toBe(150);
    expect(result.commission).toBe(15);
  });
});
