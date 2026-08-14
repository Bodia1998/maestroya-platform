import { describe, expect, it } from "vitest";

import { PricingCalculationService } from "@/domain/services/pricing-calculation-service";

describe("PricingCalculationService", () => {
  const service = new PricingCalculationService();

  it("computes total as labour + materials — the module's core rule", () => {
    const result = service.calculate({ labour: 5000, materials: 1000 });
    expect(result).toEqual({ labour: 5000, materials: 1000, total: 6000 });
  });

  it("handles zero labour", () => {
    const result = service.calculate({ labour: 0, materials: 500 });
    expect(result.total).toBe(500);
  });

  it("handles zero materials", () => {
    const result = service.calculate({ labour: 500, materials: 0 });
    expect(result.total).toBe(500);
  });

  it("handles labour only (materials omitted as zero)", () => {
    const result = service.calculate({ labour: 1200, materials: 0 });
    expect(result).toEqual({ labour: 1200, materials: 0, total: 1200 });
  });

  it("handles materials only (labour omitted as zero)", () => {
    const result = service.calculate({ labour: 0, materials: 850 });
    expect(result).toEqual({ labour: 0, materials: 850, total: 850 });
  });

  it("handles an all-zero quote without error", () => {
    const result = service.calculate({ labour: 0, materials: 0 });
    expect(result).toEqual({ labour: 0, materials: 0, total: 0 });
  });

  it("handles materials greater than labour", () => {
    const result = service.calculate({ labour: 200, materials: 5000 });
    expect(result.total).toBe(5200);
  });

  it("handles large numbers without precision drift", () => {
    const result = service.calculate({ labour: 987654.32, materials: 12345.67 });
    expect(result.total).toBe(999999.99);
  });

  it("rounds to whole cents deterministically (no floating-point drift)", () => {
    const first = service.calculate({ labour: 33.33, materials: 11.11 });
    const second = service.calculate({ labour: 33.33, materials: 11.11 });
    expect(first).toEqual(second);
    expect(first.total).toBe(44.44);
  });

  it("is a pure, deterministic function", () => {
    const input = { labour: 1234.56, materials: 78.9 };
    const results = Array.from({ length: 5 }, () => service.calculate(input));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });

  it("rejects a negative labour amount", () => {
    expect(() => service.calculate({ labour: -1, materials: 0 })).toThrow();
  });

  it("rejects a negative materials amount", () => {
    expect(() => service.calculate({ labour: 0, materials: -1 })).toThrow();
  });

  it("rejects a non-finite labour amount", () => {
    expect(() => service.calculate({ labour: Number.NaN, materials: 0 })).toThrow();
  });

  it("accepts an empty adjustments array as a no-op (reserved extension point)", () => {
    const result = service.calculate({ labour: 100, materials: 50, adjustments: [] });
    expect(result.total).toBe(150);
  });
});
