import { describe, expect, it } from "vitest";

import {
  decideCalibratedLeadPrice,
  isLeadCalibrationProvenance,
  priceReviewedJobValue,
  type CalibratedPricingInput,
} from "@/domain/services/lead-calibrated-estimate";
import { confidenceBand, scoreEstimateConfidence } from "@/domain/services/lead-estimate-confidence";
import {
  LEAD_PRICE_BASE_RATE,
  LEAD_PRICE_CEILING,
  LEAD_PRICE_FLOOR,
  findCalibrationEntry,
  validateRegionalCalibrationConfig,
  type RegionalCalibrationConfig,
  type RegionalCalibrationEntry,
} from "@/domain/services/lead-regional-calibration";
import { LEAD_FLOW_VERSION } from "@/domain/services/lead";
import { LEAD_REGIONAL_CALIBRATION_V1 } from "@/infrastructure/pricing/lead-regional-calibration.v1";
import { deriveLeadPricingRegion, provinceCodeFromSpanishPostalCode, resolvePricingTerritory } from "@/domain/services/spain-pricing-territory";
import { parseLeadRegionalPricingConfig } from "@/domain/services/lead-regional-pricing-mode";

const approved = (over: Partial<RegionalCalibrationEntry> = {}): RegionalCalibrationEntry => ({
  categorySlug: "fontaneria",
  provinceCodes: ["28", "08", "07"],
  status: "APPROVED",
  jobValueLow: "100.00",
  jobValueHigh: "200.00",
  approvalRef: "TEST-APPROVAL-1",
  evidence: { kind: "MARKET_REFERENCE", reference: "test-reference" },
  ...over,
});

const config = (over: Partial<RegionalCalibrationConfig> = {}): RegionalCalibrationConfig => ({
  ...LEAD_REGIONAL_CALIBRATION_V1,
  calibrationVersion: "lead-regional-pricing-test-v1",
  entries: [approved()],
  ...over,
});

const input = (over: Partial<CalibratedPricingInput> = {}): CalibratedPricingInput => ({
  flowVersion: LEAD_FLOW_VERSION,
  categorySlug: "fontaneria",
  parentCategorySlug: null,
  region: { status: "RESOLVED", provinceCode: "28" },
  scope: { status: "NONE", questionnaireConfigured: false },
  ...over,
});

describe("M164 D1 — pricing territory", () => {
  it.each([
    ["28001", "28"],
    ["07001", "07"],
    ["08001", "08"],
    ["01001", "01"],
    ["52001", "52"],
  ])("derives the province from %s", (zip, province) => {
    expect(provinceCodeFromSpanishPostalCode(zip)).toBe(province);
  });

  it.each(["", "2800", "280011", "ABCDE", "00001", "53001", null, undefined, 28001 as never])("rejects malformed postal code %s", (zip) => {
    expect(provinceCodeFromSpanishPostalCode(zip as never)).toBeNull();
  });

  it("supports mainland Spain and the Balearic Islands only", () => {
    expect(resolvePricingTerritory("28")).toMatchObject({ status: "SUPPORTED", territory: "MAINLAND_SPAIN" });
    expect(resolvePricingTerritory("07")).toMatchObject({ status: "SUPPORTED", territory: "BALEARIC_ISLANDS" });
    expect(resolvePricingTerritory("35")).toMatchObject({ status: "UNSUPPORTED", reason: "CANARY_ISLANDS" });
    expect(resolvePricingTerritory("38")).toMatchObject({ status: "UNSUPPORTED", reason: "CANARY_ISLANDS" });
    expect(resolvePricingTerritory("51")).toMatchObject({ status: "UNSUPPORTED", reason: "CEUTA" });
    expect(resolvePricingTerritory("52")).toMatchObject({ status: "UNSUPPORTED", reason: "MELILLA" });
  });

  it("resolves a region only for Spanish addresses with a valid postal code", () => {
    expect(deriveLeadPricingRegion({ country: "ES", postalCode: "28001" })).toMatchObject({ status: "RESOLVED", provinceCode: "28" });
    expect(deriveLeadPricingRegion({ country: "FR", postalCode: "28001" }).status).toBe("UNKNOWN");
    expect(deriveLeadPricingRegion({ country: "ES", postalCode: "x" }).status).toBe("UNKNOWN");
    expect(deriveLeadPricingRegion(null).status).toBe("UNKNOWN");
  });
});

describe("M164 D3 — configuration contract", () => {
  it("the shipped release is valid, enables nothing and keeps the supply multiplier disabled", () => {
    const resolved = validateRegionalCalibrationConfig(LEAD_REGIONAL_CALIBRATION_V1);
    expect(resolved.status).toBe("VALID");
    expect(LEAD_REGIONAL_CALIBRATION_V1.entries).toEqual([]);
    expect(LEAD_REGIONAL_CALIBRATION_V1.supplyMultiplier).toEqual({ status: "DISABLED" });
    expect(LEAD_REGIONAL_CALIBRATION_V1.baseRate).toBe(LEAD_PRICE_BASE_RATE);
    expect(LEAD_REGIONAL_CALIBRATION_V1.minimumPrice).toBe(LEAD_PRICE_FLOOR);
    expect(LEAD_REGIONAL_CALIBRATION_V1.maximumPrice).toBe(LEAD_PRICE_CEILING);
  });

  it("accepts a fully evidenced entry", () => {
    expect(validateRegionalCalibrationConfig(config()).status).toBe("VALID");
  });

  it.each<[string, Partial<RegionalCalibrationConfig>]>([
    ["a base rate other than 10%", { baseRate: "0.12" }],
    ["a floor below EUR 20", { minimumPrice: "10.00" }],
    ["a ceiling above EUR 400", { maximumPrice: "500.00" }],
    ["an entry covering the Canary Islands", { entries: [approved({ provinceCodes: ["35"] })] }],
    ["an entry covering Ceuta", { entries: [approved({ provinceCodes: ["51"] })] }],
    ["an entry covering Melilla", { entries: [approved({ provinceCodes: ["52"] })] }],
    ["an APPROVED entry without an approval reference", { entries: [approved({ approvalRef: undefined })] }],
    ["an APPROVED entry without evidence", { entries: [approved({ evidence: undefined })] }],
    ["an inverted range", { entries: [approved({ jobValueLow: "300.00", jobValueHigh: "100.00" })] }],
    ["a duplicate category/province pair", { entries: [approved(), approved({ provinceCodes: ["28"] })] }],
  ])("rejects %s", (_name, over) => {
    expect(validateRegionalCalibrationConfig(config(over)).status).not.toBe("VALID");
  });

  it("never falls back to another province", () => {
    const c = config();
    expect(findCalibrationEntry(c, "fontaneria", null, "28").status).toBe("FOUND");
    expect(findCalibrationEntry(c, "fontaneria", null, "41").status).toBe("NOT_CONFIGURED");
  });

  it("non-objects are not a valid configuration", () => {
    for (const bad of [null, undefined, 1, "x", []]) expect(validateRegionalCalibrationConfig(bad).status).not.toBe("VALID");
  });
});

describe("M164 D3 — price formula", () => {
  // Range 100..200 → average 150 → 10% = 15.00 → floor lifts to 20.00 (needs a wider range to clear the floor).
  const priceFor = (low: string, high: string) => {
    const cfg = config({ entries: [approved({ jobValueLow: low, jobValueHigh: high })] });
    return decideCalibratedLeadPrice(input(), cfg);
  };

  const priceOf = (d: ReturnType<typeof decideCalibratedLeadPrice>) => {
    if (d.decision === "UNPRICED") throw new Error("unpriced:" + d.reason);
    if (d.decision === "REVIEW_REQUIRED") return null;
    return d.priced;
  };

  it("review (not auto) when no validated scope exists — confidence is capped without evidence", () => {
    const d = priceFor("1000.00", "1000.00");
    expect(d.decision).toBe("REVIEW_REQUIRED");
  });

  it("an admin-reviewed value is priced at exactly 10% of the value", () => {
    const r = priceReviewedJobValue(
      { flowVersion: LEAD_FLOW_VERSION, categorySlug: "fontaneria", parentCategorySlug: null, region: { status: "RESOLVED", provinceCode: "28" }, reviewedJobValue: "800.00", reviewId: "r1", reviewReasons: ["CALIBRATION_MISSING"] },
      config(),
    );
    expect(r.status).toBe("PRICED");
    if (r.status === "PRICED") {
      expect(r.priced.price).toBe("80.00");
      expect(r.provenance.source).toBe("ADMIN_REVIEW");
      expect(r.provenance.baseRate).toBe("0.10");
    }
  });

  it.each([
    ["50.00", "20.00", "MINIMUM"],
    ["200.00", "20.00", null],
    ["201.00", "20.10", null],
    ["2000.00", "200.00", null],
  ])("reviewed value %s → price %s", (value, price, cap) => {
    const r = priceReviewedJobValue(
      { flowVersion: LEAD_FLOW_VERSION, categorySlug: "fontaneria", parentCategorySlug: null, region: { status: "RESOLVED", provinceCode: "28" }, reviewedJobValue: value, reviewId: "r1", reviewReasons: [] },
      config(),
    );
    expect(r.status).toBe("PRICED");
    if (r.status === "PRICED") {
      expect(r.priced.price).toBe(price);
      expect(r.priced.capApplied).toBe(cap);
    }
  });

  it("the ceiling is never exceeded and a value above the job-value limit is unpriced, not clamped", () => {
    const cfg = config({ maximumJobValue: "10000.00" });
    const r = priceReviewedJobValue(
      { flowVersion: LEAD_FLOW_VERSION, categorySlug: "fontaneria", parentCategorySlug: null, region: { status: "RESOLVED", provinceCode: "28" }, reviewedJobValue: "9000.00", reviewId: "r1", reviewReasons: [] },
      cfg,
    );
    expect(r.status).toBe("PRICED");
    if (r.status === "PRICED") expect(r.priced.price).toBe("400.00");
    const over = priceReviewedJobValue(
      { flowVersion: LEAD_FLOW_VERSION, categorySlug: "fontaneria", parentCategorySlug: null, region: { status: "RESOLVED", provinceCode: "28" }, reviewedJobValue: "10000.01", reviewId: "r1", reviewReasons: [] },
      cfg,
    );
    expect(over).toEqual({ status: "UNPRICED", reason: "VALUE_EXCEEDS_CEILING" });
  });

  it.each(["0", "-5.00", "abc", "10.005", "", null, 100 as never])("rejects reviewed value %s", (value) => {
    const r = priceReviewedJobValue(
      { flowVersion: LEAD_FLOW_VERSION, categorySlug: "fontaneria", parentCategorySlug: null, region: { status: "RESOLVED", provinceCode: "28" }, reviewedJobValue: value, reviewId: "r1", reviewReasons: [] },
      config(),
    );
    expect(r.status).toBe("UNPRICED");
  });

  it("is deterministic", () => {
    const a = JSON.stringify(priceFor("100.00", "300.00"));
    const b = JSON.stringify(priceFor("100.00", "300.00"));
    expect(a).toBe(b);
    expect(priceOf(priceFor("100.00", "300.00"))).toBeNull();
  });
});

describe("M164 — three-way decision and fail-closed gates", () => {
  it("shipped release: every supported-territory request goes to review (nothing auto-priced, nothing invented)", () => {
    const d = decideCalibratedLeadPrice(input(), LEAD_REGIONAL_CALIBRATION_V1);
    expect(d.decision).toBe("REVIEW_REQUIRED");
    if (d.decision === "REVIEW_REQUIRED") {
      expect(d.reasons).toContain("CALIBRATION_MISSING");
      expect(d.provenance.price).toBeNull();
      expect(d.provenance.entryState).toBe("NOT_CONFIGURED");
    }
  });

  it("does not fall back to another region", () => {
    const d = decideCalibratedLeadPrice(input({ region: { status: "RESOLVED", provinceCode: "41" } }), config());
    expect(d.decision).toBe("REVIEW_REQUIRED");
    if (d.decision === "REVIEW_REQUIRED") expect(d.reasons).toContain("CALIBRATION_MISSING");
  });

  it("a pending-evidence entry is review, not a price", () => {
    const d = decideCalibratedLeadPrice(
      input(),
      config({ entries: [{ categorySlug: "fontaneria", provinceCodes: ["28"], status: "PENDING_EVIDENCE" }] }),
    );
    expect(d.decision).toBe("REVIEW_REQUIRED");
    if (d.decision === "REVIEW_REQUIRED") expect(d.reasons).toContain("CALIBRATION_PENDING_EVIDENCE");
  });

  it("an explicitly unsupported combination is unpriced", () => {
    const d = decideCalibratedLeadPrice(
      input(),
      config({ entries: [{ categorySlug: "fontaneria", provinceCodes: ["28"], status: "UNSUPPORTED" }] }),
    );
    expect(d).toEqual({ decision: "UNPRICED", reason: "COMBINATION_UNSUPPORTED" });
  });

  it("an unsupported category (reformas) is unpriced", () => {
    expect(decideCalibratedLeadPrice(input({ categorySlug: "reformas" }), config())).toEqual({ decision: "UNPRICED", reason: "CATEGORY_UNSUPPORTED" });
  });

  it.each([
    ["Canary Islands", "35"],
    ["Ceuta", "51"],
    ["Melilla", "52"],
  ])("%s is never priced (D1)", (_n, province) => {
    expect(decideCalibratedLeadPrice(input({ region: { status: "RESOLVED", provinceCode: province } }), config())).toEqual({
      decision: "UNPRICED",
      reason: "TERRITORY_UNSUPPORTED",
    });
  });

  it("unknown region, missing category, wrong flow and tampered scope fail closed", () => {
    expect(decideCalibratedLeadPrice(input({ region: { status: "UNKNOWN", reason: "POSTAL_CODE_INVALID" } as never }), config())).toEqual({ decision: "UNPRICED", reason: "REGION_UNRESOLVED" });
    expect(decideCalibratedLeadPrice(input({ categorySlug: null }), config())).toEqual({ decision: "UNPRICED", reason: "CATEGORY_MISSING" });
    expect(decideCalibratedLeadPrice(input({ flowVersion: "LEGACY" }), config())).toEqual({ decision: "UNPRICED", reason: "NOT_LEAD_V1" });
    expect(decideCalibratedLeadPrice(input({ scope: { status: "INVALID" } }), config())).toEqual({ decision: "UNPRICED", reason: "SCOPE_INVALID" });
  });

  it("conflicting answers go to review", () => {
    const d = decideCalibratedLeadPrice(input({ scope: { status: "CONFLICTING" } }), config());
    expect(d.decision).toBe("REVIEW_REQUIRED");
    if (d.decision === "REVIEW_REQUIRED") expect(d.reasons).toContain("CONFLICTING_ANSWERS");
  });

  it("provenance produced by the engine passes its own guard; a tampered one does not", () => {
    const d = decideCalibratedLeadPrice(input(), config());
    if (d.decision === "UNPRICED") throw new Error("unexpected");
    expect(isLeadCalibrationProvenance(d.provenance)).toBe(true);
    expect(isLeadCalibrationProvenance({ ...d.provenance, provenanceVersion: 2 })).toBe(false);
    expect(isLeadCalibrationProvenance({ ...d.provenance, source: "SOMEONE" })).toBe(false);
    expect(isLeadCalibrationProvenance(null)).toBe(false);
  });
});

describe("M164 D4 — confidence is explainable and completeness is not accuracy", () => {
  const policy = LEAD_REGIONAL_CALIBRATION_V1.confidencePolicy;
  const validated = { minimumValidationSample: 100, minimumValidationRate: "0.90" };

  it("without a recorded validation the score cannot exceed 8/10 and is never HIGH", () => {
    const entry = approved({ jobValueLow: "100.00", jobValueHigh: "110.00" });
    const c = scoreEstimateConfidence({ scope: "VALIDATED", entry, match: "CATEGORY" }, policy);
    expect(c.score).toBeLessThanOrEqual(8);
    expect(c.interpretation).toBe("HEURISTIC_EVIDENCE_SCORE_NOT_AN_ACCURACY_ESTIMATE");
    expect(confidenceBand(c)).not.toBe("HIGH");
    expect(c.components.map((x) => x.code)).toContain("EMPIRICAL_VALIDATION");
    expect(c.components.find((x) => x.code === "EMPIRICAL_VALIDATION")?.points).toBe(0);
  });

  it("no entry and no questionnaire scores low", () => {
    const c = scoreEstimateConfidence({ scope: "QUESTIONNAIRE_NOT_CONFIGURED", entry: null, match: null }, policy);
    expect(c.score).toBeLessThan(policy.autoPublishMinimumScore);
    expect(c.meetsThreshold).toBe(false);
  });

  it("a recorded validation below the sample/rate bar earns nothing; one above it can reach HIGH", () => {
    const base = approved({ jobValueLow: "100.00", jobValueHigh: "105.00" });
    const weak = scoreEstimateConfidence(
      { scope: "VALIDATED", entry: { ...base, validation: { method: "HOLDOUT", sampleSize: 10, toleranceRelative: "0.20", withinToleranceRate: "0.99", datasetReference: "d" } }, match: "CATEGORY" },
      policy,
    );
    expect(weak.components.find((x) => x.code === "EMPIRICAL_VALIDATION")?.points).toBe(0);
    const strong = scoreEstimateConfidence(
      { scope: "VALIDATED", entry: { ...base, validation: { method: "HOLDOUT", sampleSize: validated.minimumValidationSample, toleranceRelative: "0.20", withinToleranceRate: "0.91", datasetReference: "d" } }, match: "CATEGORY" },
      policy,
    );
    expect(strong.components.find((x) => x.code === "EMPIRICAL_VALIDATION")?.points).toBeGreaterThan(0);
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("every component is bounded and the total equals their sum", () => {
    const c = scoreEstimateConfidence({ scope: "VALIDATED", entry: approved(), match: "PARENT_CATEGORY" }, policy);
    for (const comp of c.components) {
      expect(comp.points).toBeGreaterThanOrEqual(0);
      expect(comp.points).toBeLessThanOrEqual(comp.maximum);
    }
    expect(c.components.reduce((s, x) => s + x.points, 0)).toBe(c.score);
    expect(c.maximum).toBe(10);
  });
});

describe("M164 — mode switch parsing", () => {
  it("defaults to OFF and fails to OFF on anything unknown", () => {
    expect(parseLeadRegionalPricingConfig(undefined, undefined).mode).toBe("OFF");
    expect(parseLeadRegionalPricingConfig("", "").mode).toBe("OFF");
    expect(parseLeadRegionalPricingConfig("enforce-ish", "v1").mode).toBe("OFF");
  });

  it("accepts the three modes exactly", () => {
    for (const m of ["OFF", "SHADOW", "ENFORCE"] as const) expect(parseLeadRegionalPricingConfig(m, "lead-regional-pricing-v1").mode).toBe(m);
  });

  it("SHADOW/ENFORCE without a version keep the mode but carry no version (the resolver then fails closed — no implicit default)", () => {
    for (const m of ["SHADOW", "ENFORCE"] as const) {
      const c = parseLeadRegionalPricingConfig(m, undefined);
      expect(c.mode).toBe(m);
      expect(c.calibrationVersion).toBeNull();
    }
  });
});
