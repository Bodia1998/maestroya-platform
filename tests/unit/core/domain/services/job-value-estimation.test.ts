import { describe, expect, it } from "vitest";

import {
  estimateJobValue,
  isValidJobValueEstimationConfig,
  type JobValueEstimationConfig,
  type JobValueEstimationContext,
} from "@/domain/services/job-value-estimation";
import { JOB_VALUE_ESTIMATION_CONFIG_V1 } from "@/infrastructure/pricing/job-value-estimation-config.v1";

const config = (patch: Partial<JobValueEstimationConfig> = {}): JobValueEstimationConfig => ({
  ruleVersion: "test-v1",
  baseValueBySlug: { fontaneria: "150.00", fontanero: "120.00", pintura: "350.00" },
  urgencyFactors: { LOW: "1.0", MEDIUM: "1.0", HIGH: "1.0", EMERGENCY: "1.0" },
  maximumValue: "2000.00",
  ...patch,
});

const ctx = (patch: Partial<JobValueEstimationContext> = {}): JobValueEstimationContext => ({
  flowVersion: "LEAD_V1",
  categorySlug: "fontaneria",
  parentCategorySlug: null,
  urgency: "MEDIUM",
  ...patch,
});

describe("estimateJobValue — valid estimation", () => {
  it("estimates a supported top-level category: exact EUR value, LOW confidence, rule version", () => {
    expect(estimateJobValue(ctx(), config())).toEqual({
      status: "ESTIMATED",
      estimatedServiceValue: "150.00",
      currency: "EUR",
      confidence: "LOW",
      baseValue: "150.00",
      baseValueSource: "CATEGORY",
      factors: { scope: "1.0", urgency: "1.0", complexity: "1.0" },
      ruleVersion: "test-v1",
    });
  });

  it("an exact subcategory entry wins over its parent and earns MEDIUM", () => {
    const r = estimateJobValue(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }), config());
    expect(r).toMatchObject({ status: "ESTIMATED", estimatedServiceValue: "120.00", confidence: "MEDIUM", baseValueSource: "CATEGORY" });
  });

  it("a subcategory without its own entry falls back to the parent at LOW confidence", () => {
    const r = estimateJobValue(ctx({ categorySlug: "otro", parentCategorySlug: "fontaneria" }), config());
    expect(r).toMatchObject({ status: "ESTIMATED", estimatedServiceValue: "150.00", confidence: "LOW", baseValueSource: "PARENT_CATEGORY" });
  });

  it("never produces HIGH confidence in V1 (no structured scope input exists)", () => {
    for (const c of [ctx(), ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }), ctx({ categorySlug: "x", parentCategorySlug: "pintura" })]) {
      const r = estimateJobValue(c, config());
      expect(r.status === "ESTIMATED" && r.confidence).not.toBe("HIGH");
    }
  });

  it("is deterministic: same context -> identical result", () => {
    const a = estimateJobValue(ctx({ urgency: "HIGH" }), config({ urgencyFactors: { HIGH: "1.25" } }));
    const b = estimateJobValue(ctx({ urgency: "HIGH" }), config({ urgencyFactors: { HIGH: "1.25" } }));
    expect(a).toEqual(b);
    expect(a).toMatchObject({ estimatedServiceValue: "187.50" });
  });

  it("unknown or missing urgency is neutral", () => {
    expect(estimateJobValue(ctx({ urgency: null }), config({ urgencyFactors: { HIGH: "2.0" } }))).toMatchObject({ estimatedServiceValue: "150.00" });
    expect(estimateJobValue(ctx({ urgency: "WHENEVER" }), config({ urgencyFactors: { HIGH: "2.0" } }))).toMatchObject({ estimatedServiceValue: "150.00" });
  });
});

describe("estimateJobValue — customer budget separation", () => {
  it("the context type has no budget input and a budget smuggled in is ignored", () => {
    const withBudget = { ...ctx(), budgetMin: "100.00", budgetMax: "100.00", customerBudgetMin: "100.00", customerBudgetMax: "100.00" } as JobValueEstimationContext;
    const r = estimateJobValue(withBudget, config());
    expect(r).toMatchObject({ status: "ESTIMATED", estimatedServiceValue: "150.00" });
    expect(r).toEqual(estimateJobValue(ctx(), config()));
  });

  it("a budget cannot make an unconfigured category estimable", () => {
    const smuggled = { ...ctx({ categorySlug: "reformas" }), budgetMax: "5000.00" } as JobValueEstimationContext;
    expect(estimateJobValue(smuggled, config())).toMatchObject({ status: "UNAVAILABLE", reason: "CATEGORY_NOT_CONFIGURED" });
  });
});

describe("estimateJobValue — fail closed", () => {
  it.each([
    ["missing category (null)", ctx({ categorySlug: null }), "UNAVAILABLE", "CATEGORY_MISSING"],
    ["missing category (empty)", ctx({ categorySlug: "" }), "UNAVAILABLE", "CATEGORY_MISSING"],
    ["unsupported category", ctx({ categorySlug: "limpieza" }), "UNAVAILABLE", "CATEGORY_NOT_CONFIGURED"],
    ["unsupported subcategory with unsupported parent", ctx({ categorySlug: "x", parentCategorySlug: "limpieza" }), "UNAVAILABLE", "CATEGORY_NOT_CONFIGURED"],
    ["large-project category left unconfigured", ctx({ categorySlug: "reformas" }), "UNAVAILABLE", "CATEGORY_NOT_CONFIGURED"],
    ["non-string category", ctx({ categorySlug: 42 as unknown as string }), "INVALID_INPUT", "INVALID_CATEGORY"],
  ])("%s", (_n, c, status, reason) => {
    expect(estimateJobValue(c, config())).toMatchObject({ status, reason, ruleVersion: "test-v1" });
  });

  it("never returns a value field on failure", () => {
    expect(estimateJobValue(ctx({ categorySlug: "limpieza" }), config())).not.toHaveProperty("estimatedServiceValue");
  });

  it("production V1 config: reformas is UNAVAILABLE, configured categories are LOW", () => {
    expect(estimateJobValue(ctx({ categorySlug: "reformas" }), JOB_VALUE_ESTIMATION_CONFIG_V1)).toMatchObject({ status: "UNAVAILABLE", reason: "CATEGORY_NOT_CONFIGURED" });
    for (const slug of ["fontaneria", "electricidad", "aire-acondicionado", "pintura", "montaje-de-muebles"]) {
      expect(estimateJobValue(ctx({ categorySlug: slug }), JOB_VALUE_ESTIMATION_CONFIG_V1)).toMatchObject({ status: "ESTIMATED", confidence: "LOW", ruleVersion: JOB_VALUE_ESTIMATION_CONFIG_V1.ruleVersion });
    }
  });
});

describe("estimateJobValue — LEAD_V1 boundary", () => {
  it("accepts LEAD_V1", () => {
    expect(estimateJobValue(ctx({ flowVersion: "LEAD_V1" }), config()).status).toBe("ESTIMATED");
  });
  it.each(["LEGACY_QUOTE_PAYMENT", "", "lead_v1", null, undefined])("rejects %s", (flow) => {
    expect(estimateJobValue(ctx({ flowVersion: flow }), config())).toMatchObject({ status: "UNAVAILABLE", reason: "NOT_LEAD_V1" });
  });
});

describe("estimateJobValue — configuration validation", () => {
  it.each([
    ["empty rule version", { ruleVersion: " " }],
    ["negative base", { baseValueBySlug: { fontaneria: "-1.00" } }],
    ["zero base", { baseValueBySlug: { fontaneria: "0.00" } }],
    ["NaN base", { baseValueBySlug: { fontaneria: "NaN" } }],
    ["exponent base", { baseValueBySlug: { fontaneria: "1e3" } }],
    ["3-decimal base", { baseValueBySlug: { fontaneria: "10.001" } }],
    ["base above ceiling", { baseValueBySlug: { fontaneria: "2000.01" } }],
    ["empty slug key", { baseValueBySlug: { "": "10.00" } }],
    ["zero urgency factor", { urgencyFactors: { HIGH: "0" } }],
    ["urgency factor above 10", { urgencyFactors: { HIGH: "10.000001" } }],
    ["garbage urgency factor", { urgencyFactors: { HIGH: "fast" } }],
    ["zero ceiling", { maximumValue: "0.00" }],
    ["malformed ceiling", { maximumValue: "lots" }],
  ] as [string, Partial<JobValueEstimationConfig>][])("%s -> INVALID_CONFIGURATION", (_n, patch) => {
    expect(isValidJobValueEstimationConfig(config(patch))).toBe(false);
    expect(estimateJobValue(ctx(), config(patch))).toMatchObject({ status: "INVALID_INPUT", reason: "INVALID_CONFIGURATION", ruleVersion: null });
  });

  it("the shipped V1 config is valid", () => {
    expect(isValidJobValueEstimationConfig(JOB_VALUE_ESTIMATION_CONFIG_V1)).toBe(true);
  });

  it("legacy flow wins over a broken configuration (never estimated)", () => {
    expect(estimateJobValue(ctx({ flowVersion: "LEGACY_QUOTE_PAYMENT" }), config({ maximumValue: "x" }))).toMatchObject({ status: "UNAVAILABLE", reason: "NOT_LEAD_V1" });
  });
});

describe("estimateJobValue — money", () => {
  const one = (base: string, urgency: string, maximumValue = "2000.00") =>
    estimateJobValue(ctx({ urgency: "HIGH" }), config({ baseValueBySlug: { fontaneria: base }, urgencyFactors: { HIGH: urgency }, maximumValue }));

  it("has no floating-point drift (0.10 x 3 = 0.30)", () => {
    expect(one("0.10", "3.0")).toMatchObject({ estimatedServiceValue: "0.30" });
    expect(one("0.10", "1.1")).toMatchObject({ estimatedServiceValue: "0.11" });
  });

  it("rounds half-up once, to whole cents", () => {
    expect(one("10.01", "1.5")).toMatchObject({ estimatedServiceValue: "15.02" }); // 15.015
    expect(one("0.01", "0.5")).toMatchObject({ estimatedServiceValue: "0.01" }); // 0.005
    expect(one("10.00", "1.000499")).toMatchObject({ estimatedServiceValue: "10.00" }); // 10.00499
    expect(one("10.00", "1.0005")).toMatchObject({ estimatedServiceValue: "10.01" }); // 10.005
  });

  it("always renders exactly two decimals", () => {
    expect(one("12.5", "1.0")).toMatchObject({ estimatedServiceValue: "12.50" });
    expect(one("12", "1.0")).toMatchObject({ estimatedServiceValue: "12.00" });
  });

  it("a value that rounds to zero is not returned as 0", () => {
    expect(one("0.01", "0.4")).toMatchObject({ status: "UNAVAILABLE", reason: "INVALID_CONFIGURATION" });
  });

  it("ceiling boundary: equal is allowed, one cent above is UNAVAILABLE (not clamped)", () => {
    expect(one("100.00", "1.0", "100.00")).toMatchObject({ status: "ESTIMATED", estimatedServiceValue: "100.00" });
    expect(one("100.00", "1.0001", "100.00")).toMatchObject({ status: "UNAVAILABLE", reason: "VALUE_EXCEEDS_CEILING" }); // 100.01
    expect(one("100.00", "1.00004", "100.00")).toMatchObject({ status: "ESTIMATED", estimatedServiceValue: "100.00" }); // 100.004 rounds down
  });
});
