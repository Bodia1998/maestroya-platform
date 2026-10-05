import { describe, expect, it } from "vitest";

import {
  calculateLeadPrice,
  formatScaledDecimal,
  isValidLeadPricingConfig,
  parseScaledDecimal,
  type LeadPricingConfig,
  type LeadPricingContext,
} from "@/domain/services/lead-pricing";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";

const config = (patch: Partial<LeadPricingConfig> = {}): LeadPricingConfig => ({ ...LEAD_PRICING_CONFIG_V1, ...patch });
const ctx = (patch: Partial<LeadPricingContext> = {}, amount = "600.00", confidence: "HIGH" | "MEDIUM" | "LOW" = "HIGH"): LeadPricingContext => ({
  flowVersion: "LEAD_V1",
  categorySlug: "pintura",
  parentCategorySlug: null,
  urgency: "MEDIUM",
  estimatedServiceValue: { amount, currency: "EUR", confidence },
  ...patch,
});
const priced = (c: LeadPricingContext, cfg = config()) => {
  const r = calculateLeadPrice(c, cfg);
  if (r.status !== "PRICED") throw new Error(`expected PRICED, got ${r.status}/${r.reason}`);
  return r;
};

describe("calculateLeadPrice — basic rates", () => {
  it("10% category (pintura)", () => {
    const r = priced(ctx());
    expect(r).toMatchObject({ price: "60.00", currency: "EUR", rate: "0.10", rateSource: "CATEGORY", confidence: "HIGH", capApplied: null });
    expect(r.ruleVersion).toBe(LEAD_PRICING_CONFIG_V1.ruleVersion);
    expect(r.estimatedServiceValue).toBe("600.00");
  });
  it("12% category (fontaneria)", () => expect(priced(ctx({ categorySlug: "fontaneria" }, "500.00")).price).toBe("60.00"));
  it("13% category (aire-acondicionado)", () => expect(priced(ctx({ categorySlug: "aire-acondicionado" }, "1000.00")).price).toBe("130.00"));
  it("15% category (reformas)", () => expect(priced(ctx({ categorySlug: "reformas" }, "700.00")).price).toBe("105.00"));
});

describe("calculateLeadPrice — minimum / maximum / large projects", () => {
  it("below minimum -> minimum applied", () => {
    const r = priced(ctx({}, "20.00"));
    expect(r).toMatchObject({ price: "5.00", uncappedPrice: "2.00", capApplied: "MINIMUM" });
  });
  it("exactly minimum -> no cap reported", () => expect(priced(ctx({}, "50.00"))).toMatchObject({ price: "5.00", capApplied: null }));
  it("above maximum -> maximum applied", () => {
    expect(priced(ctx({}, "2000.00"))).toMatchObject({ price: "150.00", uncappedPrice: "200.00", capApplied: "MAXIMUM" });
  });
  it("exactly maximum -> no cap reported", () => expect(priced(ctx({}, "1500.00"))).toMatchObject({ price: "150.00", capApplied: null }));
  it("EUR 50,000 renovation does not produce an absurd price", () => {
    const r = priced(ctx({ categorySlug: "reformas" }, "50000.00"));
    expect(r).toMatchObject({ price: "150.00", uncappedPrice: "7500.00", capApplied: "MAXIMUM" });
  });
  it("cap values come from configuration", () => {
    expect(priced(ctx({}, "2000.00"), config({ maximumPrice: "400.00" })).price).toBe("200.00");
  });
});

describe("calculateLeadPrice — decimal safety and rounding", () => {
  it("fractional service value is exact", () => expect(priced(ctx({ categorySlug: "fontaneria" }, "1234.56")).price).toBe("148.15")); // 148.1472
  it("half-up at exactly half a cent (float would be ambiguous)", () => {
    expect(priced(ctx({}, "100.05")).price).toBe("10.01"); // 10.005
    expect(priced(ctx({}, "100.04")).price).toBe("10.00"); // 10.004
    expect(priced(ctx({}, "100.06")).price).toBe("10.01"); // 10.006
  });
  it("classic float traps stay exact", () => {
    expect(priced(ctx({}, "1.15"), config({ minimumPrice: "0.01" })).price).toBe("0.12"); // 0.115 -> 0.12
    expect(priced(ctx({ categorySlug: "fontaneria" }, "0.29"), config({ minimumPrice: "0.01" })).price).toBe("0.03"); // 0.0348
  });
  it("urgency factor is applied exactly when configured", () => {
    const r = priced(ctx({ urgency: "HIGH" }, "100.00"), config({ urgencyFactors: { HIGH: "1.5" }, minimumPrice: "1.00" }));
    expect(r.price).toBe("15.00");
    expect(r.factors).toEqual({ complexity: "1.0", urgency: "1.5", leadQuality: "1.0", market: "1.0" });
  });
  it("default configuration is neutral for every factor", () => {
    const r = priced(ctx({ urgency: "EMERGENCY" }));
    expect(r.factors).toEqual({ complexity: "1.0", urgency: "1.0", leadQuality: "1.0", market: "1.0" });
  });
  it("unknown / missing urgency uses the neutral factor", () => {
    expect(priced(ctx({ urgency: null })).factors.urgency).toBe("1.0");
    expect(priced(ctx({ urgency: "WHATEVER" })).factors.urgency).toBe("1.0");
  });
  it("helpers", () => {
    expect(parseScaledDecimal("12.3", 2)).toBe(1230n);
    expect(parseScaledDecimal("12.345", 2)).toBeNull();
    expect(parseScaledDecimal("-1", 2)).toBeNull();
    expect(formatScaledDecimal(1230n, 2, 2)).toBe("12.30");
    expect(formatScaledDecimal(120_000n, 6, 2)).toBe("0.12");
  });
});

describe("calculateLeadPrice — invalid input fails closed", () => {
  const reason = (c: LeadPricingContext, cfg = config()) => {
    const r = calculateLeadPrice(c, cfg);
    return r.status === "PRICED" ? "PRICED" : `${r.status}:${r.reason}`;
  };
  it.each(["-5.00", "0", "0.00", "NaN", "Infinity", "-Infinity", "1e3", "12.345", "", " 5", "5 ", "abc", "1,000.00", "9999999999999.00"])(
    "service value %j -> INVALID_INPUT",
    (amount) => expect(reason(ctx({}, amount))).toBe("INVALID_INPUT:INVALID_SERVICE_VALUE"),
  );
  it("non-string service value -> INVALID_INPUT", () => {
    for (const amount of [600, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      const c = ctx();
      (c.estimatedServiceValue as { amount: unknown }).amount = amount;
      expect(reason(c)).toBe("INVALID_INPUT:INVALID_SERVICE_VALUE");
    }
  });
  it("invalid currency", () => {
    const c = ctx();
    c.estimatedServiceValue!.currency = "USD";
    expect(reason(c)).toBe("INVALID_INPUT:INVALID_CURRENCY");
  });
  it("invalid confidence value", () => {
    const c = ctx();
    (c.estimatedServiceValue as { confidence: unknown }).confidence = "CERTAIN";
    expect(reason(c)).toBe("INVALID_INPUT:INVALID_CONFIDENCE");
  });
  it("missing service value -> UNPRICED (never invented)", () => {
    expect(reason(ctx({ estimatedServiceValue: null }))).toBe("UNPRICED:SERVICE_VALUE_UNAVAILABLE");
  });
  it("missing category / missing rate -> UNPRICED", () => {
    expect(reason(ctx({ categorySlug: null }))).toBe("UNPRICED:CATEGORY_MISSING");
    expect(reason(ctx({ categorySlug: "" }))).toBe("UNPRICED:CATEGORY_MISSING");
    expect(reason(ctx({ categorySlug: "limpieza" }))).toBe("UNPRICED:RATE_NOT_CONFIGURED");
    expect(reason(ctx({ categorySlug: "limpieza", parentCategorySlug: "tampoco" }))).toBe("UNPRICED:RATE_NOT_CONFIGURED");
  });
  it.each([
    ["minimum above maximum", { minimumPrice: "200.00", maximumPrice: "100.00" }],
    ["zero minimum", { minimumPrice: "0.00" }],
    ["malformed minimum", { minimumPrice: "abc" }],
    ["negative minimum", { minimumPrice: "-1.00" }],
    ["maximum with >2 decimals", { maximumPrice: "100.001" }],
    ["maximum above Decimal(10,2)", { maximumPrice: "100000000.00" }],
    ["negative factor", { urgencyFactors: { HIGH: "-1" } }],
    ["zero factor", { urgencyFactors: { HIGH: "0" } }],
    ["non-numeric factor", { urgencyFactors: { HIGH: "abc" } }],
    ["huge factor", { urgencyFactors: { HIGH: "11" } }],
    ["zero rate", { rateBySlug: { pintura: "0" } }],
    ["rate above 100%", { rateBySlug: { pintura: "1.5" } }],
    ["negative rate", { rateBySlug: { pintura: "-0.1" } }],
    ["non-numeric rate", { rateBySlug: { pintura: "10%" } }],
    ["empty rule version", { ruleVersion: " " }],
    ["bad minimum confidence", { minimumConfidence: "NONE" as never }],
  ])("invalid configuration (%s) -> INVALID_INPUT, no price", (_n, patch) => {
    expect(isValidLeadPricingConfig(config(patch))).toBe(false);
    expect(reason(ctx(), config(patch))).toBe("INVALID_INPUT:INVALID_CONFIGURATION");
  });
  it("the shipped V1 configuration is valid", () => expect(isValidLeadPricingConfig(LEAD_PRICING_CONFIG_V1)).toBe(true));
});

describe("calculateLeadPrice — legacy isolation", () => {
  it.each(["LEGACY_QUOTE_PAYMENT", "", null, undefined, "lead_v1", "SOMETHING_ELSE"])("flow %j -> UNPRICED, no price", (flowVersion) => {
    expect(calculateLeadPrice(ctx({ flowVersion }), config())).toMatchObject({ status: "UNPRICED", reason: "NOT_LEAD_V1" });
  });
});

describe("calculateLeadPrice — category resolution and confidence", () => {
  it("subcategory falls back to the parent category rate with MEDIUM confidence", () => {
    const r = priced(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }, "500.00"));
    expect(r).toMatchObject({ price: "60.00", rate: "0.12", rateSource: "PARENT_CATEGORY", confidence: "MEDIUM" });
  });
  it("a configured subcategory rate overrides the parent with HIGH confidence", () => {
    const r = priced(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }, "500.00"), config({ rateBySlug: { fontaneria: "0.12", fontanero: "0.11" } }));
    expect(r).toMatchObject({ price: "55.00", rate: "0.11", rateSource: "CATEGORY", confidence: "HIGH" });
  });
  it("reliable category + HIGH value -> HIGH", () => expect(priced(ctx()).confidence).toBe("HIGH"));
  it("MEDIUM value estimate -> MEDIUM", () => expect(priced(ctx({}, "600.00", "MEDIUM")).confidence).toBe("MEDIUM"));
  it("confidence is the weakest link (MEDIUM value + parent fallback)", () => {
    expect(priced(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }, "500.00", "MEDIUM")).confidence).toBe("MEDIUM");
  });
  it("LOW confidence is UNPRICED by default, never silently priced", () => {
    expect(calculateLeadPrice(ctx({}, "600.00", "LOW"), config())).toMatchObject({ status: "UNPRICED", reason: "CONFIDENCE_TOO_LOW" });
  });
  it("LOW is reported honestly when configuration explicitly allows it", () => {
    expect(priced(ctx({}, "600.00", "LOW"), config({ minimumConfidence: "LOW" })).confidence).toBe("LOW");
  });
  it("HIGH is never claimed above the inputs", () => {
    expect(priced(ctx({}, "600.00", "LOW"), config({ minimumConfidence: "LOW" })).confidence).not.toBe("HIGH");
  });
});

describe("calculateLeadPrice — determinism and safety", () => {
  it("same input + same configuration -> identical output, inputs untouched", () => {
    const c = Object.freeze(ctx({ categorySlug: "fontaneria" }, "1234.56"));
    const cfg = Object.freeze(config());
    const first = JSON.stringify(calculateLeadPrice(c, cfg));
    for (let i = 0; i < 25; i++) expect(JSON.stringify(calculateLeadPrice(c, cfg))).toBe(first);
  });
  it("a configuration change changes only later results (pure function, no hidden state)", () => {
    expect(priced(ctx()).price).toBe("60.00");
    expect(priced(ctx(), config({ rateBySlug: { pintura: "0.20" } })).price).toBe("120.00");
    expect(priced(ctx()).price).toBe("60.00");
  });
  it("result exposes only pricing data", () => {
    const r = priced(ctx());
    expect(Object.keys(r).sort()).toEqual(
      ["capApplied", "confidence", "currency", "estimatedServiceValue", "factors", "price", "rate", "rateSource", "ruleVersion", "status", "uncappedPrice"],
    );
  });
  it("never throws on garbage context", () => {
    expect(() => calculateLeadPrice(null as never, config())).not.toThrow();
    expect(() => calculateLeadPrice({} as never, config())).not.toThrow();
    expect(() => calculateLeadPrice(ctx(), null as never)).not.toThrow();
  });
});
