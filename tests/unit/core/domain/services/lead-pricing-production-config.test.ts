import { describe, expect, it } from "vitest";

import { calculateLeadPrice, isValidLeadPricingConfig } from "@/domain/services/lead-pricing";
import {
  LeadPricingConfigurationError,
  validateLeadPricingProductionConfig,
  type LeadPricingConfigResolution,
} from "@/domain/services/lead-pricing-production-config";
import { LEAD_PRICING_PILOT_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import { LEAD_PRICING_TEST_CONFIG } from "../../../../test-utils/pricing/lead-pricing-test-config";

/** Fresh, mutable deep copy of the pilot snapshot to break in a targeted way. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately untyped: tests corrupt a copy of the config in arbitrary ways
type Draft = any;
const draft = (): Draft => JSON.parse(JSON.stringify(LEAD_PRICING_PILOT_CONFIG_V1));
const check = (mutate: (d: Draft) => void): LeadPricingConfigResolution => {
  const d = draft();
  mutate(d);
  return validateLeadPricingProductionConfig(d);
};
const paths = (r: LeadPricingConfigResolution) => ("issues" in r ? r.issues.map((i) => i.path) : []);

describe("validateLeadPricingProductionConfig — valid production configuration", () => {
  it("accepts the pilot snapshot", () => {
    const r = validateLeadPricingProductionConfig(LEAD_PRICING_PILOT_CONFIG_V1);
    expect(r.status).toBe("VALID");
    if (r.status === "VALID") expect(r.config).toEqual(LEAD_PRICING_PILOT_CONFIG_V1);
  });

  it("the engines' own validators agree with the pilot snapshot", () => {
    expect(isValidLeadPricingConfig(LEAD_PRICING_PILOT_CONFIG_V1.leadPricing)).toBe(true);
  });

  it("returns a deep-frozen COPY: neither the snapshot nor later mutation of the source can change a calculation", () => {
    const source = draft();
    const r = validateLeadPricingProductionConfig(source);
    if (r.status !== "VALID") throw new Error("expected VALID");
    source.leadPricing.rateBySlug.pintura = "0.99";
    source.leadPricing.maximumPrice = "9999.00";
    expect(r.config.leadPricing.rateBySlug.pintura).toBe("0.10");
    expect(Object.isFrozen(r.config)).toBe(true);
    expect(Object.isFrozen(r.config.leadPricing)).toBe(true);
    expect(Object.isFrozen(r.config.leadPricing.rateBySlug)).toBe(true);
    expect(Object.isFrozen(r.config.jobValue.baseValueBySlug)).toBe(true);
    expect(Object.isFrozen(r.config.pilotCategorySlugs)).toBe(true);
    expect(() => {
      (r.config.leadPricing.rateBySlug as Record<string, string>).pintura = "0.5";
    }).toThrow(TypeError);
  });
});

describe("validateLeadPricingProductionConfig — missing / incomplete", () => {
  it.each([undefined, null])("%s is INCOMPLETE", (value) => {
    expect(validateLeadPricingProductionConfig(value).status).toBe("INCOMPLETE");
  });

  it("a non-object is INVALID, not 'missing'", () => {
    expect(validateLeadPricingProductionConfig("lead-pricing-pilot-v1").status).toBe("INVALID");
    expect(validateLeadPricingProductionConfig([]).status).toBe("INVALID");
  });

  it.each([
    ["configVersion", (d: Draft) => delete d.configVersion],
    ["profile", (d: Draft) => delete d.profile],
    ["currency", (d: Draft) => delete d.currency],
    ["pilotCategorySlugs", (d: Draft) => delete d.pilotCategorySlugs],
    ["jobValue", (d: Draft) => delete d.jobValue],
    ["jobValue.maximumValue", (d: Draft) => delete d.jobValue.maximumValue],
    ["jobValue.baseValueBySlug", (d: Draft) => delete d.jobValue.baseValueBySlug],
    ["leadPricing", (d: Draft) => delete d.leadPricing],
    ["leadPricing.rateBySlug", (d: Draft) => delete d.leadPricing.rateBySlug],
    ["leadPricing.minimumPrice", (d: Draft) => delete d.leadPricing.minimumPrice],
    ["leadPricing.maximumPrice", (d: Draft) => delete d.leadPricing.maximumPrice],
    ["leadPricing.minimumConfidence", (d: Draft) => delete d.leadPricing.minimumConfidence],
    ["leadPricing.ruleVersion", (d: Draft) => delete d.leadPricing.ruleVersion],
  ])("missing %s -> INCOMPLETE naming that path", (path, mutate) => {
    const r = check(mutate);
    expect(r.status).toBe("INCOMPLETE");
    expect(paths(r)).toContain(path);
    if ("issues" in r) expect(r.issues.every((i) => i.code === "MISSING")).toBe(true);
  });

  it("an empty pilot category list is INCOMPLETE", () => {
    expect(check((d) => (d.pilotCategorySlugs = [])).status).toBe("INCOMPLETE");
  });

  it("reports every problem at once so an operator can fix them in one pass", () => {
    const r = check((d) => {
      delete d.leadPricing.minimumConfidence;
      delete d.leadPricing.maximumPrice;
      delete d.jobValue.maximumValue;
    });
    expect(paths(r)).toEqual(expect.arrayContaining(["leadPricing.minimumConfidence", "leadPricing.maximumPrice", "jobValue.maximumValue"]));
  });

  it("INVALID wins over INCOMPLETE when both kinds of issue exist", () => {
    const r = check((d) => {
      delete d.leadPricing.maximumPrice;
      d.leadPricing.rateBySlug.pintura = "abc";
    });
    expect(r.status).toBe("INVALID");
  });
});

describe("validateLeadPricingProductionConfig — malformed values and invalid rates", () => {
  it.each(["abc", "", "0,12", "-0.1", "+0.1", "1e-1", ".1", "0.1234567", " 0.1", "NaN", "Infinity"])("rejects malformed rate %j", (rate) => {
    const r = check((d) => (d.leadPricing.rateBySlug.pintura = rate));
    expect(r.status).toBe("INVALID");
    expect(paths(r)).toContain("leadPricing.rateBySlug.pintura");
  });

  it("rejects a JS number where a decimal string is required (no float money)", () => {
    expect(check((d) => (d.leadPricing.rateBySlug.pintura = 0.1)).status).toBe("INVALID");
    expect(check((d) => (d.leadPricing.minimumPrice = 5)).status).toBe("INVALID");
    expect(check((d) => (d.jobValue.baseValueBySlug.pintura = 350)).status).toBe("INVALID");
  });

  it.each(["0", "0.00", "1.000001", "2", "10"])("rejects out-of-range rate %s (must be in (0, 1])", (rate) => {
    expect(check((d) => (d.leadPricing.rateBySlug.fontaneria = rate)).status).toBe("INVALID");
  });

  it("rejects malformed urgency factors", () => {
    expect(check((d) => (d.leadPricing.urgencyFactors.HIGH = "-1")).status).toBe("INVALID");
    expect(check((d) => (d.leadPricing.urgencyFactors.HIGH = "0")).status).toBe("INVALID");
    expect(check((d) => (d.leadPricing.urgencyFactors.HIGH = "11")).status).toBe("INVALID");
    expect(check((d) => (d.jobValue.urgencyFactors.HIGH = "x")).status).toBe("INVALID");
  });

  it("rejects a bad minimumConfidence and a bad configVersion / profile", () => {
    expect(check((d) => (d.leadPricing.minimumConfidence = "VERY_HIGH")).status).toBe("INVALID");
    expect(check((d) => (d.configVersion = "Lead Pricing V1")).status).toBe("INVALID");
    expect(check((d) => (d.profile = "STAGING")).status).toBe("INVALID");
  });

  it("rejects identical rule versions for the two rule sets", () => {
    expect(check((d) => (d.leadPricing.ruleVersion = d.jobValue.ruleVersion)).status).toBe("INVALID");
  });
});

describe("validateLeadPricingProductionConfig — monetary bounds", () => {
  it("rejects maximum below minimum", () => {
    const r = check((d) => {
      d.leadPricing.minimumPrice = "10.00";
      d.leadPricing.maximumPrice = "5.00";
    });
    expect(r.status).toBe("INVALID");
    expect(paths(r)).toContain("leadPricing.maximumPrice");
  });

  it("accepts minimum equal to maximum", () => {
    expect(
      check((d) => {
        d.leadPricing.minimumPrice = "5.00";
        d.leadPricing.maximumPrice = "5.00";
      }).status,
    ).toBe("VALID");
  });

  it.each(["0", "0.00", "-1.00", "5,00", "5.001", "abc"])("rejects minimum price %j", (value) => {
    expect(check((d) => (d.leadPricing.minimumPrice = value)).status).toBe("INVALID");
  });

  it("rejects a maximum beyond the Decimal(10,2) storage bound", () => {
    expect(check((d) => (d.leadPricing.maximumPrice = "100000000.00")).status).toBe("INVALID");
  });

  it("rejects a base job value above the job-value ceiling, and a zero base value", () => {
    expect(check((d) => (d.jobValue.baseValueBySlug.pintura = "2000.01")).status).toBe("INVALID");
    expect(check((d) => (d.jobValue.baseValueBySlug.pintura = "0.00")).status).toBe("INVALID");
    expect(check((d) => (d.jobValue.maximumValue = "0.00")).status).toBe("INVALID");
  });
});

describe("validateLeadPricingProductionConfig — categories", () => {
  it("a pilot category without a lead rate is INVALID (never silently priced or guessed)", () => {
    const r = check((d) => delete d.leadPricing.rateBySlug.pintura);
    expect(r.status).toBe("INVALID");
    expect(paths(r)).toContain("leadPricing.rateBySlug.pintura");
  });

  it("a pilot category without a base job value is INVALID", () => {
    const r = check((d) => delete d.jobValue.baseValueBySlug.pintura);
    expect(r.status).toBe("INVALID");
    expect(paths(r)).toContain("jobValue.baseValueBySlug.pintura");
  });

  it("a rate for a category that is not a pilot category is INVALID", () => {
    expect(check((d) => (d.leadPricing.rateBySlug.reformas = "0.15")).status).toBe("INVALID");
    expect(check((d) => (d.jobValue.baseValueBySlug.reformas = "800.00")).status).toBe("INVALID");
  });

  it("a category cannot be both pilot and unsupported", () => {
    const r = check((d) => d.leadPricing.unsupportedCategorySlugs.push("pintura"));
    expect(r.status).toBe("INVALID");
  });

  it("rejects duplicate / empty / non-string category slugs", () => {
    expect(check((d) => d.pilotCategorySlugs.push("pintura")).status).toBe("INVALID");
    expect(check((d) => d.pilotCategorySlugs.push("")).status).toBe("INVALID");
    expect(check((d) => d.leadPricing.unsupportedCategorySlugs.push(7)).status).toBe("INVALID");
    expect(check((d) => (d.leadPricing.unsupportedCategorySlugs = "reformas")).status).toBe("INVALID");
  });

  it("the pilot snapshot declares reformas explicitly unsupported and prices only seeded categories", () => {
    expect(LEAD_PRICING_PILOT_CONFIG_V1.leadPricing.unsupportedCategorySlugs).toEqual(["reformas"]);
    expect([...LEAD_PRICING_PILOT_CONFIG_V1.pilotCategorySlugs].sort()).toEqual(["aire-acondicionado", "electricidad", "fontaneria", "montaje-de-muebles", "pintura"]);
  });
});

describe("validateLeadPricingProductionConfig — currency", () => {
  it.each(["USD", "eur", "GBP", ""])("rejects currency %j (mismatch with the Lead purchase currency)", (currency) => {
    const r = check((d) => (d.currency = currency));
    expect(r.status).toBe("INVALID");
    expect(paths(r)).toContain("currency");
  });

  it("the engine itself refuses a non-EUR service value (no silent currency mixing)", () => {
    const r = calculateLeadPrice(
      { flowVersion: "LEAD_V1", categorySlug: "pintura", parentCategorySlug: null, urgency: null, estimatedServiceValue: { amount: "350.00", currency: "USD", confidence: "LOW" } },
      LEAD_PRICING_PILOT_CONFIG_V1.leadPricing,
    );
    expect(r).toMatchObject({ status: "INVALID_INPUT", reason: "INVALID_CURRENCY" });
  });
});

describe("validateLeadPricingProductionConfig — test-only configuration", () => {
  it("a TEST_ONLY profile is reported as TEST_ONLY, never VALID, for production", () => {
    expect(validateLeadPricingProductionConfig(LEAD_PRICING_TEST_CONFIG).status).toBe("TEST_ONLY");
    expect(check((d) => (d.profile = "TEST_ONLY")).status).toBe("TEST_ONLY");
  });

  it("is only accepted when a test explicitly allows it", () => {
    expect(validateLeadPricingProductionConfig(LEAD_PRICING_TEST_CONFIG, { allowTestOnly: true }).status).toBe("VALID");
  });

  it("a broken TEST_ONLY configuration is still reported as broken", () => {
    const d = JSON.parse(JSON.stringify(LEAD_PRICING_TEST_CONFIG));
    d.leadPricing.rateBySlug.pintura = "-1";
    expect(validateLeadPricingProductionConfig(d).status).toBe("INVALID");
  });
});

describe("LeadPricingConfigurationError", () => {
  it("lists every path with its code in the message", () => {
    const e = new LeadPricingConfigurationError("INCOMPLETE", [{ path: "leadPricing.minimumPrice", code: "MISSING", message: "minimum lead price is missing" }]);
    expect(e.code).toBe("LEAD_PRICING_CONFIGURATION_INVALID");
    expect(e.message).toContain("INCOMPLETE");
    expect(e.message).toContain("leadPricing.minimumPrice (MISSING");
  });
});
