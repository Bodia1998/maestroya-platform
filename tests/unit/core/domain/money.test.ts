import { describe, expect, it } from "vitest";

import { calculateQuoteItemAmount, calculateQuoteTotal, roundToCents } from "@/domain/services/money";

describe("roundToCents", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundToCents(10.005)).toBeCloseTo(10.01, 2);
    expect(roundToCents(10.004)).toBeCloseTo(10, 2);
  });

  it("avoids classic floating point drift (0.1 + 0.2)", () => {
    expect(roundToCents(0.1 + 0.2)).toBe(0.3);
  });
});

describe("calculateQuoteItemAmount", () => {
  it("multiplies quantity by unit price", () => {
    expect(calculateQuoteItemAmount(2, 50)).toBe(100);
  });

  it("rounds the result to whole cents", () => {
    expect(calculateQuoteItemAmount(3, 33.333)).toBeCloseTo(100, 2);
  });

  it("returns 0 for a zero unit price", () => {
    expect(calculateQuoteItemAmount(5, 0)).toBe(0);
  });
});

describe("calculateQuoteTotal", () => {
  it("sums the calculated amount of every item, not a client-supplied total", () => {
    const total = calculateQuoteTotal([
      { quantity: 2, unitPrice: 50 },
      { quantity: 1, unitPrice: 25.5 },
    ]);
    expect(total).toBe(125.5);
  });

  it("returns 0 for an empty item list", () => {
    expect(calculateQuoteTotal([])).toBe(0);
  });

  it("does not accumulate floating point drift across many items", () => {
    const items = Array.from({ length: 10 }, () => ({ quantity: 1, unitPrice: 0.1 }));
    expect(calculateQuoteTotal(items)).toBe(1);
  });
});
