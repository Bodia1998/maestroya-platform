import { describe, expect, it } from "vitest";

import {
  InvalidTaxRateError,
  TaxCalculationError,
  UnsupportedCountryError,
} from "@/domain/errors/domain-error";
import { DEFAULT_COMMISSION_RATES, calculateCommissionBreakdown } from "@/domain/services/commission-policy";
import { COMMISSION_CALCULATION_SERVICE } from "@/domain/services/commission-calculation-service";
import {
  CURRENT_IRPF_WITHHOLDING_RATE_BPS,
  calculateMaestroYaTaxBreakdown,
  calculateTaxReversal,
} from "@/domain/services/maestroya-tax-calculation-service";
import { SPAIN_IVA_RATES_BPS } from "@/domain/services/spain-iva-calculator";
import type { TaxCalculatorRegistry } from "@/domain/services/tax-calculator";

/**
 * Module 78 — IVA / Tax Integration: comprehensive tests for the
 * authoritative MaestroYa tax calculation layer. The canonical worked
 * example from the module spec (labour 1000, professional materials 200)
 * is used throughout so every field's exact value is traceable back to the
 * spec's own numbers.
 */

const CANONICAL_INPUT = {
  labourAmount: 1000,
  professionalMaterialsAmount: 200,
  countryCode: "ES",
};

describe("calculateMaestroYaTaxBreakdown — canonical example (Module 78 spec)", () => {
  it("computes the full customer + professional + commission breakdown exactly", () => {
    const result = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);

    // Bases
    expect(result.labourBase).toBe(1000);
    expect(result.professionalMaterialsBase).toBe(200);
    expect(result.customerMaterialsBase).toBe(0);

    // Customer side
    expect(result.customerTaxableBase).toBe(1200);
    expect(result.customerVatRateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.customerVatAmount).toBe(252);
    expect(result.customerGrossTotal).toBe(1452);

    // Commission (Module 65/64 10% rule — never on gross including IVA)
    expect(result.commissionBase).toBe(1200);
    expect(result.commissionRateBps).toBe(1000);
    expect(result.commissionAmount).toBe(120);

    // Professional invoice side
    expect(result.professionalNetBase).toBe(1080);
    expect(result.professionalVatRateBps).toBe(SPAIN_IVA_RATES_BPS.GENERAL);
    expect(result.professionalVatAmount).toBe(226.8);
    expect(result.professionalInvoiceGrossTotal).toBe(1306.8);

    // IRPF — must be zero under the current MaestroYa/AEAT model
    expect(result.irpfWithholdingRateBps).toBe(0);
    expect(result.irpfWithholdingAmount).toBe(0);

    // Payout
    expect(result.professionalPayoutAmount).toBe(1306.8);
  });

  it("never double-charges IVA: customer IVA and professional IVA are independent amounts", () => {
    const result = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);
    // customerVatAmount (252) must never equal or be derived from
    // professionalVatAmount (226.80) — they are taxed on different bases.
    expect(result.customerVatAmount).not.toBe(result.professionalVatAmount);
    expect(result.customerVatAmount + result.professionalVatAmount).toBeCloseTo(478.8, 5);
    // The commission base must equal the customer's pre-tax taxable base,
    // never the gross (tax-inclusive) total.
    expect(result.commissionBase).toBe(result.customerTaxableBase);
    expect(result.commissionBase).not.toBe(result.customerGrossTotal);
  });

  it("commission is calculated on the taxable base, not gross-including-IVA", () => {
    const result = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);
    expect(result.commissionAmount).toBe(120);
    // 10% of the gross (1452) would incorrectly be 145.20 — must not equal that.
    expect(result.commissionAmount).not.toBeCloseTo(145.2, 5);
  });

  it("IVA is calculated after determining the correct taxable base (professional-purchased materials only)", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 1000,
      professionalMaterialsAmount: 200,
      customerMaterialsAmount: 500, // Scenario B materials, must never affect any tax figure
      countryCode: "ES",
    });
    expect(result.customerTaxableBase).toBe(1200);
    expect(result.customerVatAmount).toBe(252);
    expect(result.customerMaterialsBase).toBe(500);
  });
});

describe("calculateMaestroYaTaxBreakdown — Scenario A: professional-supplied materials", () => {
  it("includes professional materials in commission base and taxable base", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 1000,
      professionalMaterialsAmount: 200,
      countryCode: "ES",
    });
    expect(result.commissionBase).toBe(1200);
    expect(result.commissionAmount).toBe(120);
    expect(result.professionalNetBase).toBe(1080);
  });
});

describe("calculateMaestroYaTaxBreakdown — Scenario B: customer-purchased materials", () => {
  it("excludes customer-purchased materials from professional revenue, commission, and taxable base entirely", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 1000,
      professionalMaterialsAmount: 0,
      customerMaterialsAmount: 200,
      countryCode: "ES",
    });

    expect(result.customerTaxableBase).toBe(1000);
    expect(result.customerVatAmount).toBe(210);
    expect(result.customerGrossTotal).toBe(1210);
    expect(result.commissionBase).toBe(1000);
    expect(result.commissionAmount).toBe(100);
    expect(result.professionalNetBase).toBe(900);
    expect(result.professionalVatAmount).toBe(189);
    expect(result.customerMaterialsBase).toBe(200);
  });

  it("does not artificially inflate the professional's taxable base even when customer materials are large", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 500,
      professionalMaterialsAmount: 0,
      customerMaterialsAmount: 10000,
      countryCode: "ES",
    });
    expect(result.customerTaxableBase).toBe(500);
    expect(result.commissionBase).toBe(500);
  });
});

describe("calculateMaestroYaTaxBreakdown — edge cases", () => {
  it("handles zero materials (labour-only job)", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 1000,
      professionalMaterialsAmount: 0,
      countryCode: "ES",
    });
    expect(result.customerTaxableBase).toBe(1000);
    expect(result.customerVatAmount).toBe(210);
    expect(result.commissionAmount).toBe(100);
    expect(result.professionalNetBase).toBe(900);
    expect(result.professionalVatAmount).toBe(189);
  });

  it("handles a materials-only job (zero labour)", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 0,
      professionalMaterialsAmount: 300,
      countryCode: "ES",
    });
    expect(result.customerTaxableBase).toBe(300);
    expect(result.commissionAmount).toBe(30);
    expect(result.professionalNetBase).toBe(270);
  });

  it("handles a fully zero-value job without throwing", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 0,
      professionalMaterialsAmount: 0,
      countryCode: "ES",
    });
    expect(result.customerTaxableBase).toBe(0);
    expect(result.customerVatAmount).toBe(0);
    expect(result.customerGrossTotal).toBe(0);
    expect(result.commissionAmount).toBe(0);
    expect(result.professionalNetBase).toBe(0);
    expect(result.professionalVatAmount).toBe(0);
    expect(result.professionalPayoutAmount).toBe(0);
  });

  it("throws for a negative labourAmount", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({ labourAmount: -1, professionalMaterialsAmount: 0, countryCode: "ES" }),
    ).toThrow(TaxCalculationError);
  });

  it("throws for a negative professionalMaterialsAmount", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({ labourAmount: 100, professionalMaterialsAmount: -1, countryCode: "ES" }),
    ).toThrow(TaxCalculationError);
  });

  it("throws for a negative customerMaterialsAmount", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({
        labourAmount: 100,
        professionalMaterialsAmount: 0,
        customerMaterialsAmount: -1,
        countryCode: "ES",
      }),
    ).toThrow(TaxCalculationError);
  });

  it("throws for NaN/Infinity inputs", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({ labourAmount: NaN, professionalMaterialsAmount: 0, countryCode: "ES" }),
    ).toThrow(TaxCalculationError);
    expect(() =>
      calculateMaestroYaTaxBreakdown({
        labourAmount: Infinity,
        professionalMaterialsAmount: 0,
        countryCode: "ES",
      }),
    ).toThrow(TaxCalculationError);
  });

  it("throws for an unsupported country code", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({ labourAmount: 100, professionalMaterialsAmount: 0, countryCode: "US" }),
    ).toThrow(UnsupportedCountryError);
  });

  it("throws for an invalid IVA rate", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({
        labourAmount: 100,
        professionalMaterialsAmount: 0,
        countryCode: "ES",
        taxRateBps: 1234,
      }),
    ).toThrow(InvalidTaxRateError);
  });

  it("accepts Spain's reduced and super-reduced rates identically for customer and professional sides", () => {
    const reduced = calculateMaestroYaTaxBreakdown({
      labourAmount: 1000,
      professionalMaterialsAmount: 0,
      countryCode: "ES",
      taxRateBps: SPAIN_IVA_RATES_BPS.REDUCED,
    });
    expect(reduced.customerVatRateBps).toBe(1000);
    expect(reduced.professionalVatRateBps).toBe(1000);
    expect(reduced.customerVatAmount).toBe(100);
  });

  it("throws for an out-of-range irpfWithholdingRateBps", () => {
    expect(() =>
      calculateMaestroYaTaxBreakdown({
        labourAmount: 100,
        professionalMaterialsAmount: 0,
        countryCode: "ES",
        irpfWithholdingRateBps: -1,
      }),
    ).toThrow(TaxCalculationError);
    expect(() =>
      calculateMaestroYaTaxBreakdown({
        labourAmount: 100,
        professionalMaterialsAmount: 0,
        countryCode: "ES",
        irpfWithholdingRateBps: 10001,
      }),
    ).toThrow(TaxCalculationError);
  });
});

describe("calculateMaestroYaTaxBreakdown — rounding / fractional cents", () => {
  it("rounds cleanly for amounts that produce fractional-cent intermediate results", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 33.33,
      professionalMaterialsAmount: 11.11,
      countryCode: "ES",
    });
    // 33.33 + 11.11 = 44.44; 21% of 44.44 = 9.3324 -> rounds to 9.33
    expect(result.customerTaxableBase).toBe(44.44);
    expect(result.customerVatAmount).toBe(9.33);
    expect(result.customerGrossTotal).toBe(53.77);
    // Every field is a valid 2-decimal monetary amount.
    for (const value of Object.values(result)) {
      if (typeof value === "number") {
        expect(Math.round(value * 100)).toBeCloseTo(value * 100, 5);
      }
    }
  });

  it("is deterministic across repeated calls with the same input", () => {
    const input = { labourAmount: 123.45, professionalMaterialsAmount: 67.89, countryCode: "ES" };
    const a = calculateMaestroYaTaxBreakdown(input);
    const b = calculateMaestroYaTaxBreakdown(input);
    expect(a).toEqual(b);
  });
});

describe("calculateMaestroYaTaxBreakdown — IRPF configuration", () => {
  it("defaults to CURRENT_IRPF_WITHHOLDING_RATE_BPS (0) and never silently withholds", () => {
    expect(CURRENT_IRPF_WITHHOLDING_RATE_BPS).toBe(0);
    const result = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);
    expect(result.irpfWithholdingAmount).toBe(0);
    expect(result.professionalPayoutAmount).toBe(result.professionalInvoiceGrossTotal);
  });

  it("supports an explicit non-zero override without hardcoding it as impossible (forward-compat extension point)", () => {
    const result = calculateMaestroYaTaxBreakdown({
      ...CANONICAL_INPUT,
      irpfWithholdingRateBps: 1500, // 15% — a hypothetical future policy value, not today's default
    });
    // IRPF withheld on the professional net base (1080), never on IVA.
    expect(result.irpfWithholdingAmount).toBe(162);
    expect(result.professionalPayoutAmount).toBe(
      Math.round((result.professionalInvoiceGrossTotal - 162) * 100) / 100,
    );
  });
});

describe("Module 78 integration with the Module 64/65 commission engine", () => {
  it("commissionAmount matches calculateCommissionBreakdown computed on the same inputs", () => {
    const direct = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 200,
      rates: DEFAULT_COMMISSION_RATES,
    });
    const result = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);

    expect(result.commissionAmount).toBe(direct.commission);
    expect(result.commissionBase).toBe(direct.commissionBase);
    expect(result.professionalNetBase).toBe(direct.professionalPayout);
  });

  it("commissionAmount matches COMMISSION_CALCULATION_SERVICE.calculate directly", () => {
    const direct = COMMISSION_CALCULATION_SERVICE.calculate({ labour: 1000, materials: 200 });
    const result = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);

    expect(result.commissionAmount).toBe(direct.commission);
    expect(result.professionalNetBase).toBe(direct.professionalPayout);
  });

  it("respects a caller-supplied non-default commission rate exactly as the commission engine would", () => {
    const rates = { commissionRateBps: 500 }; // 5%, hypothetical override
    const result = calculateMaestroYaTaxBreakdown({ ...CANONICAL_INPUT, commissionRates: rates });
    const direct = calculateCommissionBreakdown({ laborSubtotal: 1000, materialsSubtotal: 200, rates });
    expect(result.commissionAmount).toBe(direct.commission);
    expect(result.commissionRateBps).toBe(500);
  });

  it("Scenario B: excludes customer materials from the commission engine call entirely", () => {
    const result = calculateMaestroYaTaxBreakdown({
      labourAmount: 1000,
      professionalMaterialsAmount: 0,
      customerMaterialsAmount: 200,
      countryCode: "ES",
    });
    const direct = calculateCommissionBreakdown({
      laborSubtotal: 1000,
      materialsSubtotal: 0, // customer materials never reach the commission engine
      rates: DEFAULT_COMMISSION_RATES,
    });
    expect(result.commissionAmount).toBe(direct.commission);
    expect(result.commissionAmount).toBe(100);
  });
});

describe("calculateTaxReversal — refund / credit-note preparation", () => {
  const original = calculateMaestroYaTaxBreakdown(CANONICAL_INPUT);

  it("a full refund reverses 100% of every figure and leaves nothing remaining", () => {
    const reversal = calculateTaxReversal(original, original.customerGrossTotal);

    expect(reversal.refundedCustomerTaxableBase).toBe(1200);
    expect(reversal.refundedCustomerVatAmount).toBe(252);
    expect(reversal.refundedCustomerGrossAmount).toBe(1452);
    expect(reversal.remainingCustomerTaxableBase).toBe(0);
    expect(reversal.remainingCustomerVatAmount).toBe(0);
    expect(reversal.remainingCustomerGrossAmount).toBe(0);

    expect(reversal.refundedCommissionAmount).toBe(120);
    expect(reversal.refundedProfessionalNetBase).toBe(1080);
    expect(reversal.refundedProfessionalVatAmount).toBe(226.8);
    expect(reversal.refundedProfessionalInvoiceGrossAmount).toBe(1306.8);
  });

  it("a zero refund reverses nothing and leaves everything remaining", () => {
    const reversal = calculateTaxReversal(original, 0);
    expect(reversal.refundedCustomerGrossAmount).toBe(0);
    expect(reversal.refundedCustomerVatAmount).toBe(0);
    expect(reversal.remainingCustomerGrossAmount).toBe(original.customerGrossTotal);
    expect(reversal.remainingCustomerVatAmount).toBe(original.customerVatAmount);
  });

  it("a partial refund's refunded base + IVA sum exactly to the refunded gross amount", () => {
    const reversal = calculateTaxReversal(original, 726); // 50% of 1452
    expect(
      Math.round((reversal.refundedCustomerTaxableBase + reversal.refundedCustomerVatAmount) * 100) / 100,
    ).toBe(726);
    expect(
      Math.round((reversal.remainingCustomerTaxableBase + reversal.remainingCustomerVatAmount) * 100) / 100,
    ).toBe(original.customerGrossTotal - 726);
  });

  it("refunded + remaining always reconstitute the original for every customer-side figure", () => {
    const reversal = calculateTaxReversal(original, 500);
    expect(
      Math.round((reversal.refundedCustomerTaxableBase + reversal.remainingCustomerTaxableBase) * 100) / 100,
    ).toBe(original.customerTaxableBase);
    expect(
      Math.round((reversal.refundedCustomerVatAmount + reversal.remainingCustomerVatAmount) * 100) / 100,
    ).toBe(original.customerVatAmount);
  });

  it("throws when the refunded amount exceeds the original gross total", () => {
    expect(() => calculateTaxReversal(original, original.customerGrossTotal + 0.01)).toThrow(
      TaxCalculationError,
    );
  });

  it("throws for a negative refunded amount", () => {
    expect(() => calculateTaxReversal(original, -1)).toThrow(TaxCalculationError);
  });

  it("handles reversal against a zero-value original without dividing by zero", () => {
    const zero = calculateMaestroYaTaxBreakdown({
      labourAmount: 0,
      professionalMaterialsAmount: 0,
      countryCode: "ES",
    });
    const reversal = calculateTaxReversal(zero, 0);
    expect(reversal.refundedCustomerGrossAmount).toBe(0);
    expect(reversal.remainingCustomerGrossAmount).toBe(0);
  });
});

describe("Module 78 — custom tax calculator registry override", () => {
  it("uses the provided registry instead of the module-global default", () => {
    const customRegistry: TaxCalculatorRegistry = new Map([
      [
        "ES",
        {
          countryCode: "ES",
          calculate: (_input: { taxableAmount: number }) => ({
            countryCode: "ES",
            rateBps: 0,
            taxAmount: 0,
          }),
        },
      ],
    ]);

    const result = calculateMaestroYaTaxBreakdown({
      ...CANONICAL_INPUT,
      taxCalculators: customRegistry,
    });
    expect(result.customerVatAmount).toBe(0);
    expect(result.professionalVatAmount).toBe(0);
    // Commission is untouched by the tax-calculator override.
    expect(result.commissionAmount).toBe(120);
  });
});
