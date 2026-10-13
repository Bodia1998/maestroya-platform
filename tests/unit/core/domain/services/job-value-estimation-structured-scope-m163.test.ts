import { describe, expect, it } from "vitest";

import { estimateJobValue, type JobValueEstimationContext } from "@/domain/services/job-value-estimation";
import { calculateLeadPrice } from "@/domain/services/lead-pricing";
import { validateLeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { deriveStructuredScope, type ScopeQuestionnaireDefinition } from "@/domain/services/lead-scope-questionnaire";
import { JOB_VALUE_ESTIMATION_CONFIG_V1 } from "@/infrastructure/pricing/job-value-estimation-config.v1";
import { LEAD_PRICING_PILOT_CONFIG_V1 as PILOT } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";

/**
 * Module 163 — Estimation v2: structured scope through the REAL estimator and
 * the REAL pilot pricing snapshot. The questionnaire is a test fixture with
 * arbitrary numbers, not an approved factor table.
 */
const resolved = validateLeadPricingProductionConfig(PILOT);
if (resolved.status !== "VALID") throw new Error("pilot snapshot must be valid");
const CONFIG = resolved.config;

const QUESTIONNAIRE: ScopeQuestionnaireDefinition = {
  questionnaireVersion: "test-scope-v1",
  categorySlug: "fontaneria",
  maxScopeFactor: "3.0",
  maxComplexityFactor: "2.0",
  questions: [
    {
      id: "size",
      required: true,
      kind: "SINGLE_CHOICE",
      options: [
        { value: "small", scopeFactor: "1.0", complexityFactor: "1.0" },
        { value: "large", scopeFactor: "3.0", complexityFactor: "2.0" },
      ],
    },
  ],
};

const base = (patch: Partial<JobValueEstimationContext> = {}): JobValueEstimationContext => ({
  flowVersion: "LEAD_V1",
  categorySlug: "fontaneria",
  parentCategorySlug: null,
  urgency: "MEDIUM",
  ...patch,
});
const scope = (scopeFactor: string, complexityFactor = "1.0", questionnaireVersion = "test-scope-v1") => ({ questionnaireVersion, scopeFactor, complexityFactor });

describe("backward compatibility — no structured scope", () => {
  it.each([undefined, null])("structuredScope %j produces exactly the pre-M163 result (no new keys)", (structuredScope) => {
    const r = estimateJobValue(base({ structuredScope }), CONFIG.jobValue);
    expect(r).toEqual({
      status: "ESTIMATED",
      estimatedServiceValue: "150.00",
      currency: "EUR",
      confidence: "LOW",
      baseValue: "150.00",
      baseValueSource: "CATEGORY",
      factors: { scope: "1.0", urgency: "1.0", complexity: "1.0" },
      ruleVersion: "job-value-pilot-v1.1",
    });
    expect(Object.keys(r)).not.toContain("scopeQuestionnaireVersion");
  });

  it("a context object without the property is identical to one with it set to null", () => {
    expect(estimateJobValue(base(), CONFIG.jobValue)).toEqual(estimateJobValue(base({ structuredScope: null }), CONFIG.jobValue));
  });

  it("the shipped pilot / provisional configurations are untouched by M163 (D3 / D4 / D21 not changed)", () => {
    expect(PILOT.configVersion).toBe("lead-pricing-pilot-v1");
    expect(PILOT.jobValue.ruleVersion).toBe("job-value-pilot-v1.1");
    expect(PILOT.leadPricing.ruleVersion).toBe("lead-pricing-pilot-v1.1");
    expect(PILOT.pilotCategorySlugs).toEqual(["fontaneria", "electricidad", "aire-acondicionado", "pintura", "montaje-de-muebles"]);
    expect(PILOT.leadPricing.minimumConfidence).toBe("LOW");
    expect(PILOT.leadPricing.minimumPrice).toBe("5.00");
    expect(PILOT.leadPricing.maximumPrice).toBe("150.00");
    expect(PILOT.leadPricing.unsupportedCategorySlugs).toEqual(["reformas"]);
    expect(PILOT.leadPricing.rateBySlug).toEqual({
      "montaje-de-muebles": "0.10",
      pintura: "0.10",
      fontaneria: "0.12",
      electricidad: "0.12",
      "aire-acondicionado": "0.13",
    });
    expect(PILOT.jobValue.baseValueBySlug).toEqual({
      "montaje-de-muebles": "90.00",
      pintura: "350.00",
      fontaneria: "150.00",
      electricidad: "150.00",
      "aire-acondicionado": "400.00",
    });
    expect(PILOT.jobValue.maximumValue).toBe("2000.00");
    expect(LEAD_PRICING_CONFIG_V1.ruleVersion).toBe("lead-pricing-v1-provisional.1");
    expect(JOB_VALUE_ESTIMATION_CONFIG_V1.ruleVersion).toBe("job-value-v1-provisional.1");
  });
});

describe("structured scope — estimate", () => {
  it("applies the factors exactly, keeps confidence at the unscoped level and records the questionnaire version", () => {
    const r = estimateJobValue(base({ structuredScope: scope("1.8", "1.3") }), CONFIG.jobValue);
    expect(r).toEqual({
      status: "ESTIMATED",
      estimatedServiceValue: "351.00", // 150.00 x 1.8 x 1.0 x 1.3
      currency: "EUR",
      confidence: "LOW", // scope never raises confidence (D4 blocker)
      baseValue: "150.00",
      baseValueSource: "CATEGORY",
      factors: { scope: "1.8", urgency: "1.0", complexity: "1.3" },
      ruleVersion: "job-value-pilot-v1.1",
      scopeQuestionnaireVersion: "test-scope-v1",
    });
  });

  it("neutral factors never change the value or the confidence", () => {
    const r = estimateJobValue(base({ structuredScope: scope("1.0") }), CONFIG.jobValue);
    expect(r).toMatchObject({ status: "ESTIMATED", estimatedServiceValue: "150.00", confidence: "LOW" });
  });

  it("completeness of answers never raises confidence: a complete scope on a category-level base stays LOW, a subcategory base stays MEDIUM", () => {
    const cfg = { ...CONFIG.jobValue, baseValueBySlug: { ...CONFIG.jobValue.baseValueBySlug, fontanero: "150.00" } };
    expect(estimateJobValue(base({ structuredScope: scope("1.8", "1.3") }), CONFIG.jobValue)).toMatchObject({ confidence: "LOW" });
    expect(estimateJobValue(base({ categorySlug: "fontanero", parentCategorySlug: "fontaneria", structuredScope: scope("1.8", "1.3") }), cfg)).toMatchObject({ confidence: "MEDIUM" });
  });

  it("composes with urgency factors and rounds once, half-up", () => {
    const cfg = { ...CONFIG.jobValue, urgencyFactors: { HIGH: "1.25" } };
    // 150.00 x 1.333333 x 1.25 x 1.0 = 249.99993.. -> 250.00
    expect(estimateJobValue(base({ urgency: "HIGH", structuredScope: scope("1.333333") }), cfg)).toMatchObject({ estimatedServiceValue: "250.00", factors: { scope: "1.333333", urgency: "1.25" } });
  });

  it("is deterministic, and a questionnaire-derived scope reproduces from the stored answers", () => {
    const registry = { fontaneria: QUESTIONNAIRE };
    const derive = () => deriveStructuredScope(registry, { flowVersion: "LEAD_V1", categorySlug: "fontaneria", parentCategorySlug: null }, { size: "large" });
    const a = derive();
    const b = derive();
    expect(a.status).toBe("STRUCTURED");
    if (a.status !== "STRUCTURED" || b.status !== "STRUCTURED") return;
    const ea = estimateJobValue(base({ structuredScope: a.structuredScope }), CONFIG.jobValue);
    const eb = estimateJobValue(base({ structuredScope: b.structuredScope }), CONFIG.jobValue);
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(ea).toMatchObject({ estimatedServiceValue: "900.00", confidence: "LOW", scopeQuestionnaireVersion: "test-scope-v1" });
  });
});

describe("structured scope — fail-closed", () => {
  it.each([
    ["zero scope factor", scope("0")],
    ["zero complexity factor", scope("1.0", "0.000000")],
    ["scope factor above 10.0", scope("10.000001")],
    ["complexity factor above 10.0", scope("1.0", "11")],
    ["negative factor", scope("-1.0")],
    ["non-numeric factor", scope("abc")],
    ["exponent factor", scope("1e2")],
    ["empty factor", scope("")],
    ["numeric (non-string) factor", { questionnaireVersion: "test-scope-v1", scopeFactor: 1.5, complexityFactor: "1.0" }],
    ["missing factor", { questionnaireVersion: "test-scope-v1", scopeFactor: "1.0" }],
    ["too many fraction digits", scope("1.0000001")],
    ["missing questionnaire version", { scopeFactor: "1.0", complexityFactor: "1.0" }],
    ["empty questionnaire version", scope("1.0", "1.0", "")],
    ["malformed questionnaire version", scope("1.0", "1.0", "Has Spaces")],
    ["a non-object", "HIGH"],
  ])("%s -> INVALID_INPUT / INVALID_SCOPE (never a silent neutral fall-back)", (_name, structuredScope) => {
    expect(estimateJobValue(base({ structuredScope: structuredScope as never }), CONFIG.jobValue)).toEqual({
      status: "INVALID_INPUT",
      reason: "INVALID_SCOPE",
      ruleVersion: "job-value-pilot-v1.1",
    });
  });

  it("answers cannot bypass the ceiling: a value above it is UNAVAILABLE, never clamped", () => {
    // aire-acondicionado 400.00 x 10 x 10 = 40,000 > 2,000
    expect(estimateJobValue(base({ categorySlug: "aire-acondicionado", structuredScope: scope("10", "10") }), CONFIG.jobValue)).toEqual({
      status: "UNAVAILABLE",
      reason: "VALUE_EXCEEDS_CEILING",
      ruleVersion: "job-value-pilot-v1.1",
    });
    // exactly at the ceiling is allowed; the first cent above is not (400.00 x 5.000001 still rounds to 2000.00)
    expect(estimateJobValue(base({ categorySlug: "aire-acondicionado", structuredScope: scope("5") }), CONFIG.jobValue)).toMatchObject({ estimatedServiceValue: "2000.00" });
    expect(estimateJobValue(base({ categorySlug: "aire-acondicionado", structuredScope: scope("5.00002") }), CONFIG.jobValue)).toMatchObject({ reason: "VALUE_EXCEEDS_CEILING" });
  });

  it("structured scope does not make an unconfigured category estimable (reformas stays unavailable)", () => {
    expect(estimateJobValue(base({ categorySlug: "reformas", structuredScope: scope("1.0") }), CONFIG.jobValue)).toEqual({
      status: "UNAVAILABLE",
      reason: "CATEGORY_NOT_CONFIGURED",
      ruleVersion: "job-value-pilot-v1.1",
    });
  });

  it.each(["LEGACY_QUOTE_PAYMENT", "", null, undefined])("flowVersion %j is never estimated, with or without structured scope", (flowVersion) => {
    expect(estimateJobValue(base({ flowVersion, structuredScope: scope("1.5") }), CONFIG.jobValue)).toMatchObject({ status: "UNAVAILABLE", reason: "NOT_LEAD_V1" });
  });
});

describe("customer budget stays absent from the estimation context", () => {
  it("budget-shaped properties on the context change nothing", () => {
    const clean = estimateJobValue(base({ structuredScope: scope("1.5") }), CONFIG.jobValue);
    const dirty = estimateJobValue(
      { ...base({ structuredScope: scope("1.5") }), budgetMin: "99999.00", budgetMax: "999999.00", customerBudget: "1.00" } as JobValueEstimationContext,
      CONFIG.jobValue,
    );
    expect(dirty).toEqual(clean);
  });
});

describe("through the real pilot pricing pipeline", () => {
  const price = (categorySlug: string, structuredScope?: ReturnType<typeof scope> | null) => {
    const ctx = base({ categorySlug, structuredScope });
    const estimate = estimateJobValue(ctx, CONFIG.jobValue);
    return calculateLeadPrice(
      {
        ...ctx,
        estimatedServiceValue: estimate.status === "ESTIMATED" ? { amount: estimate.estimatedServiceValue, currency: estimate.currency, confidence: estimate.confidence } : null,
      },
      CONFIG.leadPricing,
    );
  };

  it("without scope the pilot prices exactly as before (fontaneria 150.00 x 0.12 = 18.00)", () => {
    expect(price("fontaneria")).toMatchObject({ status: "PRICED", price: "18.00", confidence: "LOW" });
  });

  it("with scope the price follows the refined estimate (351.00 x 0.12 = 42.12) and confidence is limited by the rate match, not inflated", () => {
    expect(price("fontaneria", scope("1.8", "1.3"))).toMatchObject({ status: "PRICED", price: "42.12", estimatedServiceValue: "351.00", confidence: "LOW", capApplied: null });
  });

  it("the maximum lead price still caps the largest permitted estimate (2000.00 x 0.13 = 260 -> 150.00)", () => {
    expect(price("aire-acondicionado", scope("5"))).toMatchObject({ status: "PRICED", price: "150.00", uncappedPrice: "260.00", capApplied: "MAXIMUM" });
  });

  it("no factor combination can push the lead price above the cap: sweep of scope factors", () => {
    for (const cat of PILOT.pilotCategorySlugs) {
      for (let f = 1_000_000; f <= 10_000_000; f += 450_000) {
        const factor = `${Math.floor(f / 1_000_000)}.${String(f % 1_000_000).padStart(6, "0")}`;
        const r = price(cat, scope(factor, factor));
        if (r.status === "PRICED") expect(Number(r.price)).toBeLessThanOrEqual(150);
        else expect(["UNPRICED", "INVALID_INPUT"]).toContain(r.status);
      }
    }
  });

  it("rejected scope leaves the lead UNPRICED (fail closed), not cheap", () => {
    expect(price("fontaneria", scope("0"))).toMatchObject({ status: "UNPRICED" });
  });

  it("unsupported categories stay unsupported whatever the scope", () => {
    expect(price("reformas", scope("1.0"))).toMatchObject({ status: "UNPRICED" });
  });
});
