import { describe, expect, it } from "vitest";

import { currencyFractionDigits, formatCurrencyFromMinorUnits } from "@/shared/utils/intl-format";

describe("currency from minor units", () => {
  it("converts integer minor units using the currency's own exponent", () => {
    // The shape a Stripe amount arrives in. EUR/USD: 2 decimals.
    expect(formatCurrencyFromMinorUnits("en", 1250, "EUR")).toBe("€12.50");
    // JPY has zero decimals — a hardcoded /100 would render ¥12.5 here.
    expect(currencyFractionDigits("en", "JPY")).toBe(0);
    expect(formatCurrencyFromMinorUnits("en", 1250, "JPY")).toBe("¥1,250");
  });

  it("defaults to EUR", () => {
    expect(formatCurrencyFromMinorUnits("es", 1234)).toContain("€");
  });

  it("returns empty for non-finite input rather than 'NaN'", () => {
    expect(formatCurrencyFromMinorUnits("en", Number.POSITIVE_INFINITY)).toBe("");
  });
});
