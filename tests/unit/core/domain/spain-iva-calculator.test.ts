import { describe, expect, it } from "vitest";

import { InvalidTaxRateError, TaxCalculationError } from "@/domain/errors/domain-error";
import {
  SPAIN_IVA_CALCULATOR,
  SPAIN_IVA_RATES_BPS,
  SpainIvaCalculator,
} from "@/domain/services/spain-iva-calculator";

describe("SpainIvaCalculator", () => {
  it("defaults to the 21% general rate when no rate is given", () => {
    const result = SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 1000 });
    expect(result.rateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.taxAmount).toBe(210);
  });

  it("reports its own countryCode as ES", () => {
    expect(SPAIN_IVA_CALCULATOR.countryCode).toBe("ES");
    const result = SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 100 });
    expect(result.countryCode).toBe("ES");
  });

  it("computes 0 IVA for the exempt rate", () => {
    const result = SPAIN_IVA_CALCULATOR.calculate({
      taxableAmount: 1000,
      rateBps: SPAIN_IVA_RATES_BPS.EXEMPT,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.rateBps).toBe(0);
  });

  it("computes the reduced 10% rate correctly", () => {
    const result = SPAIN_IVA_CALCULATOR.calculate({
      taxableAmount: 1000,
      rateBps: SPAIN_IVA_RATES_BPS.REDUCED,
    });
    expect(result.taxAmount).toBe(100);
  });

  it("computes the super-reduced 4% rate correctly", () => {
    const result = SPAIN_IVA_CALCULATOR.calculate({
      taxableAmount: 1000,
      rateBps: SPAIN_IVA_RATES_BPS.SUPER_REDUCED,
    });
    expect(result.taxAmount).toBe(40);
  });

  it("computes 0 IVA on a taxable amount of 0, regardless of rate", () => {
    const result = SPAIN_IVA_CALCULATOR.calculate({
      taxableAmount: 0,
      rateBps: SPAIN_IVA_RATES_BPS.GENERAL,
    });
    expect(result.taxAmount).toBe(0);
  });

  it("rounds IVA to whole cents", () => {
    // 33.33 * 21% = 6.9993 -> rounds to 7.00
    const result = SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 33.33 });
    expect(result.taxAmount).toBe(7);
  });

  it("rejects a rate that is not one of Spain's four official IVA rates with InvalidTaxRateError", () => {
    expect(() =>
      SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 100, rateBps: 1500 }),
    ).toThrow(InvalidTaxRateError);
    expect(() =>
      SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 100, rateBps: 1500 }),
    ).toThrow(/not a valid tax rate/);
  });

  it("InvalidTaxRateError exposes the offending rate, valid rates, and error code", () => {
    try {
      SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 100, rateBps: 1500 });
      expect.unreachable("expected calculate() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTaxRateError);
      const taxRateError = error as InvalidTaxRateError;
      expect(taxRateError.code).toBe("INVALID_TAX_RATE");
      expect(taxRateError.rateBps).toBe(1500);
      expect(taxRateError.validRatesBps).toEqual(
        expect.arrayContaining([2100, 1000, 400, 0]),
      );
    }
  });

  it("rejects a negative taxable amount with TaxCalculationError", () => {
    expect(() => SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: -1 })).toThrow(
      TaxCalculationError,
    );
    expect(() => SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: -1 })).toThrow(
      /non-negative finite number/,
    );
  });

  it("rejects a non-finite taxable amount with TaxCalculationError", () => {
    expect(() =>
      SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: Number.POSITIVE_INFINITY }),
    ).toThrow(TaxCalculationError);
    expect(() => SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: Number.NaN })).toThrow(
      /non-negative finite number/,
    );
  });

  it("is instantiable directly (not only via the singleton) for future country-registry composition", () => {
    const calculator = new SpainIvaCalculator();
    expect(calculator.countryCode).toBe("ES");
    expect(calculator.calculate({ taxableAmount: 100 }).taxAmount).toBe(21);
  });

  it("large taxable amounts do not overflow or lose precision unexpectedly", () => {
    const result = SPAIN_IVA_CALCULATOR.calculate({ taxableAmount: 1_000_000 });
    expect(result.taxAmount).toBe(210_000);
  });
});
