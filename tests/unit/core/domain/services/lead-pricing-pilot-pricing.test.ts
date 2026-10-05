import { describe, expect, it } from "vitest";

import { estimateJobValue } from "@/domain/services/job-value-estimation";
import { calculateLeadPrice, isValidLeadPricingConfig, type LeadPricingConfig, type LeadPricingContext, type LeadPricingResult } from "@/domain/services/lead-pricing";
import { validateLeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { LEAD_PRICING_PILOT_CONFIG_V1 as PILOT } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import { LEAD_PRICING_TEST_CONFIG } from "../../../../test-utils/pricing/lead-pricing-test-config";

/**
 * Module 132 — behaviour of the pilot snapshot through the REAL pipeline
 * (Job Value Estimation -> Lead pricing), exactly as the production provider
 * composes it. No mocks, no float math.
 */
const resolved = validateLeadPricingProductionConfig(PILOT);
if (resolved.status !== "VALID") throw new Error("pilot snapshot must be valid");
const CONFIG = resolved.config;

function price(categorySlug: string, parentCategorySlug: string | null = null, urgency: string | null = "MEDIUM", config = CONFIG): LeadPricingResult {
  const base = { flowVersion: "LEAD_V1", categorySlug, parentCategorySlug, urgency };
  const estimate = estimateJobValue(base, config.jobValue);
  const context: LeadPricingContext = {
    ...base,
    estimatedServiceValue: estimate.status === "ESTIMATED" ? { amount: estimate.estimatedServiceValue, currency: estimate.currency, confidence: estimate.confidence } : null,
  };
  return calculateLeadPrice(context, config.leadPricing);
}

const direct = (amount: string, slug = "pintura", config: LeadPricingConfig = CONFIG.leadPricing) =>
  calculateLeadPrice(
    { flowVersion: "LEAD_V1", categorySlug: slug, parentCategorySlug: null, urgency: null, estimatedServiceValue: { amount, currency: "EUR", confidence: "LOW" } },
    config,
  );

describe("pilot snapshot — every pilot category produces a real price", () => {
  it.each([
    ["fontaneria", "18.00", "0.12"],
    ["electricidad", "18.00", "0.12"],
    ["aire-acondicionado", "52.00", "0.13"],
    ["pintura", "35.00", "0.10"],
    ["montaje-de-muebles", "9.00", "0.10"],
  ])("%s -> PRICED %s EUR (rate %s)", (slug, expected, rate) => {
    expect(price(slug)).toMatchObject({ status: "PRICED", price: expected, currency: "EUR", rate, rateSource: "CATEGORY", confidence: "LOW", capApplied: null, ruleVersion: "lead-pricing-pilot-v1.1" });
  });

  it.each([
    ["fontanero", "fontaneria", "18.00"],
    ["electricista", "electricidad", "18.00"],
    ["tecnico-climatizacion", "aire-acondicionado", "52.00"],
    ["pintor", "pintura", "35.00"],
    ["montador-de-muebles", "montaje-de-muebles", "9.00"],
  ])("child category %s is priced through its parent %s -> %s EUR", (slug, parent, expected) => {
    expect(price(slug, parent)).toMatchObject({ status: "PRICED", price: expected, rateSource: "PARENT_CATEGORY", confidence: "LOW" });
  });

  it("the previous provisional (MEDIUM) fixture could price none of them — the defect this module fixes", () => {
    const test = validateLeadPricingProductionConfig(LEAD_PRICING_TEST_CONFIG, { allowTestOnly: true });
    if (test.status !== "VALID") throw new Error("fixture must be valid");
    for (const slug of PILOT.pilotCategorySlugs) expect(price(slug, null, "MEDIUM", test.config)).toMatchObject({ status: "UNPRICED", reason: "CONFIDENCE_TOO_LOW" });
  });

  it("prices carry the configuration version identity of the lead-pricing rules", () => {
    expect((price("pintura") as { ruleVersion: string }).ruleVersion).toBe(PILOT.leadPricing.ruleVersion);
  });
});

describe("pilot snapshot — explicit unsupported / unconfigured categories", () => {
  it("reformas is explicitly CATEGORY_UNSUPPORTED (not 'value unavailable', not a guess)", () => {
    expect(price("reformas")).toMatchObject({ status: "UNPRICED", reason: "CATEGORY_UNSUPPORTED", ruleVersion: "lead-pricing-pilot-v1.1" });
  });

  it("a child of an unsupported category is unsupported too", () => {
    expect(price("reformista", "reformas")).toMatchObject({ status: "UNPRICED", reason: "CATEGORY_UNSUPPORTED" });
  });

  it("unsupported wins even when a service value is supplied", () => {
    expect(direct("1000.00", "reformas")).toMatchObject({ status: "UNPRICED", reason: "CATEGORY_UNSUPPORTED" });
  });

  it("an unknown category never gets a guessed price", () => {
    expect(price("jardineria")).toMatchObject({ status: "UNPRICED", reason: "SERVICE_VALUE_UNAVAILABLE" });
    expect(direct("100.00", "jardineria")).toMatchObject({ status: "UNPRICED", reason: "RATE_NOT_CONFIGURED" });
  });

  it("missing category is not priced", () => {
    expect(calculateLeadPrice({ flowVersion: "LEAD_V1", categorySlug: null, parentCategorySlug: null, urgency: null, estimatedServiceValue: { amount: "100.00", currency: "EUR", confidence: "LOW" } }, CONFIG.leadPricing)).toMatchObject({
      status: "UNPRICED",
      reason: "CATEGORY_MISSING",
    });
  });
});

describe("pilot snapshot — deterministic, bounded, exact decimal arithmetic", () => {
  it("same inputs and configuration version always give the identical result", () => {
    const first = price("fontaneria");
    for (let i = 0; i < 200; i++) expect(price("fontaneria")).toEqual(first);
  });

  it("a separately validated copy of the same snapshot gives the same result", () => {
    const again = validateLeadPricingProductionConfig(JSON.parse(JSON.stringify(PILOT)));
    if (again.status !== "VALID") throw new Error("expected VALID");
    expect(price("aire-acondicionado", null, "HIGH", again.config)).toEqual(price("aire-acondicionado", null, "HIGH"));
  });

  it("is category-specific: different categories/values yield different prices", () => {
    expect(new Set(["fontaneria", "aire-acondicionado", "pintura", "montaje-de-muebles"].map((s) => (price(s) as { price: string }).price)).size).toBe(4);
  });

  it("urgency is neutral in the pilot (no commercial decision yet)", () => {
    for (const urgency of ["LOW", "MEDIUM", "HIGH", "EMERGENCY", null]) expect(price("pintura", null, urgency)).toMatchObject({ price: "35.00" });
  });

  it("minimum boundary: below -> clamped to 5.00, exactly at -> not reported as capped", () => {
    expect(direct("20.00")).toMatchObject({ status: "PRICED", price: "5.00", uncappedPrice: "2.00", capApplied: "MINIMUM" });
    expect(direct("50.00")).toMatchObject({ price: "5.00", uncappedPrice: "5.00", capApplied: null });
    expect(direct("50.10")).toMatchObject({ price: "5.01", capApplied: null });
  });

  it("maximum boundary: above -> clamped to 150.00 (large-project protection), exactly at -> not capped", () => {
    expect(direct("2000.00")).toMatchObject({ price: "150.00", uncappedPrice: "200.00", capApplied: "MAXIMUM" });
    expect(direct("1500.00")).toMatchObject({ price: "150.00", capApplied: null });
    expect(direct("1499.90")).toMatchObject({ price: "149.99", capApplied: null });
    expect(direct("50000.00", "fontaneria")).toMatchObject({ price: "150.00", capApplied: "MAXIMUM" });
  });

  it("lead fee = value x rate, rounded once half-up to cents, with exact decimals", () => {
    expect(direct("1234.56", "fontaneria")).toMatchObject({ price: "148.15", uncappedPrice: "148.15" }); // 148.1472
    expect(direct("100.05")).toMatchObject({ price: "10.01" }); // 10.005 exactly half a cent -> up
    expect(direct("100.04")).toMatchObject({ price: "10.00" }); // 10.004
    expect(direct("1.15", "pintura", { ...CONFIG.leadPricing, minimumPrice: "0.01" })).toMatchObject({ price: "0.12" }); // 0.115, a classic float trap
  });

  it("output is a plain EUR decimal string with exactly two decimals", () => {
    for (const slug of PILOT.pilotCategorySlugs) {
      const r = price(slug);
      if (r.status !== "PRICED") throw new Error("expected PRICED");
      expect(r.price).toMatch(/^\d+\.\d{2}$/);
      expect(r.estimatedServiceValue).toMatch(/^\d+\.\d{2}$/);
      expect(r.currency).toBe("EUR");
    }
  });

  it("non-EUR or non-LEAD_V1 input is never priced", () => {
    expect(
      calculateLeadPrice({ flowVersion: "LEAD_V1", categorySlug: "pintura", parentCategorySlug: null, urgency: null, estimatedServiceValue: { amount: "350.00", currency: "USD", confidence: "LOW" } }, CONFIG.leadPricing),
    ).toMatchObject({ status: "INVALID_INPUT", reason: "INVALID_CURRENCY" });
    for (const flowVersion of ["LEGACY_QUOTE_PAYMENT", null, undefined, ""]) {
      expect(calculateLeadPrice({ flowVersion, categorySlug: "pintura", parentCategorySlug: null, urgency: null, estimatedServiceValue: { amount: "350.00", currency: "EUR", confidence: "HIGH" } }, CONFIG.leadPricing)).toMatchObject({
        status: "UNPRICED",
        reason: "NOT_LEAD_V1",
      });
    }
  });

  it("configuration mutation after validation cannot change a calculation (frozen snapshot)", () => {
    expect(() => {
      (CONFIG.leadPricing.rateBySlug as Record<string, string>).pintura = "0.99";
    }).toThrow(TypeError);
    expect(() => {
      (CONFIG.leadPricing as { maximumPrice: string }).maximumPrice = "9999.00";
    }).toThrow(TypeError);
    expect(price("pintura")).toMatchObject({ price: "35.00" });
  });
});

describe("engine — unsupportedCategorySlugs configuration", () => {
  const base = { ...CONFIG.leadPricing };

  it("configurations without the field behave exactly as before Module 132", () => {
    const { unsupportedCategorySlugs: _ignored, ...legacy } = base;
    expect(isValidLeadPricingConfig(legacy as LeadPricingConfig)).toBe(true);
    expect(direct("350.00", "pintura", { ...(legacy as LeadPricingConfig), minimumConfidence: "LOW" })).toMatchObject({ status: "PRICED", price: "35.00" });
  });

  it("a slug that is both rated and unsupported is a contradictory (invalid) configuration", () => {
    const bad: LeadPricingConfig = { ...base, unsupportedCategorySlugs: ["pintura"] };
    expect(isValidLeadPricingConfig(bad)).toBe(false);
    expect(direct("350.00", "pintura", bad)).toMatchObject({ status: "INVALID_INPUT", reason: "INVALID_CONFIGURATION" });
  });

  it("a malformed unsupported list is an invalid configuration", () => {
    expect(isValidLeadPricingConfig({ ...base, unsupportedCategorySlugs: [""] })).toBe(false);
    expect(isValidLeadPricingConfig({ ...base, unsupportedCategorySlugs: "reformas" as unknown as string[] })).toBe(false);
  });
});
