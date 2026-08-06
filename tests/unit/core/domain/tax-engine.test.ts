import { describe, expect, it } from "vitest";

import {
  InvalidTaxRateError,
  TaxCalculationError,
  UnsupportedCountryError,
} from "@/domain/errors/domain-error";
import { DEFAULT_COMMISSION_RATES } from "@/domain/services/commission-policy";
import { SPAIN_IVA_RATES_BPS } from "@/domain/services/spain-iva-calculator";
import {
  DEFAULT_TAX_CALCULATORS,
  calculatePriceBreakdown,
} from "@/domain/services/tax-engine";
import type { TaxCalculationInput, TaxCalculationResult, TaxCalculator } from "@/domain/services/tax-calculator";

describe("calculatePriceBreakdown (Spain)", () => {
  it("computes the full breakdown for a standard labor+materials quote", () => {
    // labor 1000, materials 500, 7.5% platform fee -> 75, IVA 21% on
    // (1000 + 500 + 75) = 1575 -> 330.75
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 500,
      countryCode: "ES",
    });

    expect(breakdown.countryCode).toBe("ES");
    expect(breakdown.serviceAmount).toBe(1000);
    expect(breakdown.materialsAmount).toBe(500);
    expect(breakdown.platformCommission).toBe(75);
    expect(breakdown.taxableAmount).toBe(1575);
    expect(breakdown.taxRateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(breakdown.taxAmount).toBe(330.75);
    expect(breakdown.totalAmount).toBe(1905.75);
  });

  it("computes zero IVA for the exempt rate while commission is still charged", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "ES",
      taxRateBps: SPAIN_IVA_RATES_BPS.EXEMPT,
    });

    expect(breakdown.platformCommission).toBe(75);
    expect(breakdown.taxAmount).toBe(0);
    expect(breakdown.totalAmount).toBe(breakdown.taxableAmount);
  });

  it("applies the reduced 10% rate when explicitly requested", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "ES",
      taxRateBps: SPAIN_IVA_RATES_BPS.REDUCED,
    });

    // taxable = 1000 + 75 = 1075; 10% -> 107.5
    expect(breakdown.taxableAmount).toBe(1075);
    expect(breakdown.taxAmount).toBe(107.5);
    expect(breakdown.totalAmount).toBe(1182.5);
  });

  it("applies the super-reduced 4% rate when explicitly requested", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "ES",
      taxRateBps: SPAIN_IVA_RATES_BPS.SUPER_REDUCED,
    });

    expect(breakdown.taxAmount).toBe(43);
  });

  it("never lets materials contribute to platform commission, even though they are taxed", () => {
    const materialsHeavy = calculatePriceBreakdown({
      serviceAmount: 100,
      materialsAmount: 10_000,
      countryCode: "ES",
    });
    const materialsFree = calculatePriceBreakdown({
      serviceAmount: 100,
      materialsAmount: 0,
      countryCode: "ES",
    });

    // Commission is identical regardless of materials amount...
    expect(materialsHeavy.platformCommission).toBe(materialsFree.platformCommission);
    expect(materialsHeavy.platformCommission).toBe(7.5);
    // ...but materials still inflate the taxable base and thus the tax.
    expect(materialsHeavy.taxableAmount).toBeGreaterThan(materialsFree.taxableAmount);
    expect(materialsHeavy.taxAmount).toBeGreaterThan(materialsFree.taxAmount);
  });

  it("handles a materials-only quote (zero labor => zero commission, tax still applies to materials)", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 0,
      materialsAmount: 500,
      countryCode: "ES",
    });

    expect(breakdown.platformCommission).toBe(0);
    expect(breakdown.taxableAmount).toBe(500);
    expect(breakdown.taxAmount).toBe(105); // 21% of 500
    expect(breakdown.totalAmount).toBe(605);
  });

  it("handles an all-zero breakdown without error", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 0,
      materialsAmount: 0,
      countryCode: "ES",
    });

    expect(breakdown.platformCommission).toBe(0);
    expect(breakdown.taxableAmount).toBe(0);
    expect(breakdown.taxAmount).toBe(0);
    expect(breakdown.totalAmount).toBe(0);
  });

  it("respects configurable commission rates rather than hardcoding 7.5%", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "ES",
      commissionRates: {
        customerPlatformFeeRateBps: 1000, // 10%
        professionalCommissionRateBps: 500,
      },
    });

    expect(breakdown.platformCommission).toBe(100);
    expect(breakdown.taxableAmount).toBe(1100);
  });

  it("rounds every stage to whole cents deterministically", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 33.33,
      materialsAmount: 11.11,
      countryCode: "ES",
    });

    // No sub-cent values should ever appear.
    for (const value of [
      breakdown.serviceAmount,
      breakdown.materialsAmount,
      breakdown.platformCommission,
      breakdown.taxableAmount,
      breakdown.taxAmount,
      breakdown.totalAmount,
    ]) {
      expect(Math.round(value * 100)).toBe(value * 100);
    }
  });

  it("totalAmount always equals taxableAmount + taxAmount", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1234.56,
      materialsAmount: 789.01,
      countryCode: "ES",
    });
    expect(breakdown.totalAmount).toBe(
      Math.round((breakdown.taxableAmount + breakdown.taxAmount) * 100) / 100,
    );
  });

  it("rejects a negative serviceAmount with TaxCalculationError", () => {
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: -1, materialsAmount: 0, countryCode: "ES" }),
    ).toThrow(TaxCalculationError);
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: -1, materialsAmount: 0, countryCode: "ES" }),
    ).toThrow(/serviceAmount/);
  });

  it("rejects a negative materialsAmount with TaxCalculationError", () => {
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: 0, materialsAmount: -1, countryCode: "ES" }),
    ).toThrow(TaxCalculationError);
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: 0, materialsAmount: -1, countryCode: "ES" }),
    ).toThrow(/materialsAmount/);
  });

  it("rejects a non-finite serviceAmount", () => {
    expect(() =>
      calculatePriceBreakdown({
        serviceAmount: Number.NaN,
        materialsAmount: 0,
        countryCode: "ES",
      }),
    ).toThrow(/serviceAmount/);
  });

  it("rejects an empty countryCode with TaxCalculationError", () => {
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: 100, materialsAmount: 0, countryCode: "" }),
    ).toThrow(TaxCalculationError);
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: 100, materialsAmount: 0, countryCode: "" }),
    ).toThrow(/countryCode/);
  });

  it("rejects an unsupported country code with UnsupportedCountryError rather than silently defaulting", () => {
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: 100, materialsAmount: 0, countryCode: "FR" }),
    ).toThrow(UnsupportedCountryError);
    try {
      calculatePriceBreakdown({ serviceAmount: 100, materialsAmount: 0, countryCode: "FR" });
      expect.unreachable("expected calculatePriceBreakdown() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCountryError);
      expect((error as UnsupportedCountryError).countryCode).toBe("FR");
      expect((error as UnsupportedCountryError).code).toBe("UNSUPPORTED_COUNTRY");
    }
  });

  it("rejects an invalid explicit tax rate for the resolved country with InvalidTaxRateError", () => {
    expect(() =>
      calculatePriceBreakdown({
        serviceAmount: 100,
        materialsAmount: 0,
        countryCode: "ES",
        taxRateBps: 1234,
      }),
    ).toThrow(InvalidTaxRateError);
    expect(() =>
      calculatePriceBreakdown({
        serviceAmount: 100,
        materialsAmount: 0,
        countryCode: "ES",
        taxRateBps: 1234,
      }),
    ).toThrow(/not a valid tax rate/);
  });

  it("resolves lowercase country codes to the same calculator as uppercase", () => {
    const lower = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 500,
      countryCode: "es",
    });
    const upper = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 500,
      countryCode: "ES",
    });
    expect(lower).toEqual(upper);
    expect(lower.countryCode).toBe("ES");
  });

  it("resolves mixed-case country codes (e.g. 'Es', 'eS') to the same calculator", () => {
    const mixed1 = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "Es",
    });
    const mixed2 = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "eS",
    });
    expect(mixed1).toEqual(mixed2);
    expect(mixed1.countryCode).toBe("ES");
  });

  it("resolves a country code with surrounding whitespace", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "  es  ",
    });
    expect(breakdown.countryCode).toBe("ES");
    expect(breakdown.taxRateBps).toBe(2100);
  });

  it("still rejects an unsupported country regardless of casing", () => {
    expect(() =>
      calculatePriceBreakdown({ serviceAmount: 100, materialsAmount: 0, countryCode: "fr" }),
    ).toThrow(UnsupportedCountryError);
  });

  it("is extensible to a future country via a caller-supplied registry, without touching Spain's implementation", () => {
    const flatRateCalculator: TaxCalculator = {
      countryCode: "XX",
      calculate(input: TaxCalculationInput): TaxCalculationResult {
        return {
          countryCode: "XX",
          rateBps: input.rateBps ?? 500,
          taxAmount: Math.round(input.taxableAmount * ((input.rateBps ?? 500) / 10000) * 100) / 100,
        };
      },
    };
    const registry = new Map(DEFAULT_TAX_CALCULATORS);
    registry.set(flatRateCalculator.countryCode, flatRateCalculator);

    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "XX",
      taxCalculators: registry,
    });

    expect(breakdown.countryCode).toBe("XX");
    expect(breakdown.taxRateBps).toBe(500);
    // Spain's own default calculator is untouched and still resolvable.
    expect(DEFAULT_TAX_CALCULATORS.get("ES")).toBeDefined();
  });

  it("uses the platform's default commission rates when none are supplied", () => {
    const breakdown = calculatePriceBreakdown({
      serviceAmount: 1000,
      materialsAmount: 0,
      countryCode: "ES",
    });
    const expectedFee =
      (1000 * DEFAULT_COMMISSION_RATES.customerPlatformFeeRateBps) / 10000;
    expect(breakdown.platformCommission).toBe(expectedFee);
  });
});
