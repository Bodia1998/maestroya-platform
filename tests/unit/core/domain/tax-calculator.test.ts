import { describe, expect, it } from "vitest";

import { UnsupportedCountryError } from "@/domain/errors/domain-error";
import {
  resolveTaxCalculator,
  type TaxCalculationInput,
  type TaxCalculationResult,
  type TaxCalculator,
  type TaxCalculatorRegistry,
} from "@/domain/services/tax-calculator";

function fakeCalculator(countryCode: string): TaxCalculator {
  return {
    countryCode,
    calculate(input: TaxCalculationInput): TaxCalculationResult {
      return { countryCode, rateBps: input.rateBps ?? 0, taxAmount: 0 };
    },
  };
}

describe("resolveTaxCalculator", () => {
  const registry: TaxCalculatorRegistry = new Map([["ES", fakeCalculator("ES")]]);

  it("resolves an exact-case country code", () => {
    expect(resolveTaxCalculator("ES", registry).countryCode).toBe("ES");
  });

  it("resolves a lowercase country code to the same calculator", () => {
    expect(resolveTaxCalculator("es", registry).countryCode).toBe("ES");
  });

  it("resolves mixed-case country codes ('Es', 'eS')", () => {
    expect(resolveTaxCalculator("Es", registry).countryCode).toBe("ES");
    expect(resolveTaxCalculator("eS", registry).countryCode).toBe("ES");
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(resolveTaxCalculator("  es  ", registry).countryCode).toBe("ES");
  });

  it("throws UnsupportedCountryError for a country not in the registry", () => {
    expect(() => resolveTaxCalculator("fr", registry)).toThrow(UnsupportedCountryError);
  });

  it("UnsupportedCountryError carries the normalized country code and error code", () => {
    try {
      resolveTaxCalculator("fr", registry);
      expect.unreachable("expected resolveTaxCalculator() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCountryError);
      expect((error as UnsupportedCountryError).countryCode).toBe("FR");
      expect((error as UnsupportedCountryError).code).toBe("UNSUPPORTED_COUNTRY");
    }
  });
});
