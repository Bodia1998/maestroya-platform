import { describe, expect, it } from "vitest";

import {
  assertNoLeakage,
  evaluateEstimateAccuracy,
  isHoldout,
  isWithinTolerance,
  splitObservations,
  type EstimateObservation,
} from "@/domain/services/lead-estimate-accuracy";
import { LeadEstimateOutcomeRejectedError, normalizeLeadEstimateOutcome } from "@/domain/services/lead-estimate-outcome";
import {
  LeadPricingReviewRejectedError,
  LeadPricingUnderReviewError,
  REVIEW_FINGERPRINT_PATTERN,
  canDecideLeadPricingReview,
  computeReviewInputFingerprint,
  isLeadPricingReviewUuid,
  isReviewableAdmin,
  normalizeLeadPricingReviewDecision,
  type ReviewFingerprintInput,
} from "@/domain/services/lead-pricing-review";

describe("M164 — accuracy tolerance (exact arithmetic, never floating point)", () => {
  it.each([
    ["120.00", "100.00", "0.20", true],
    ["120.01", "100.00", "0.20", false],
    ["80.00", "100.00", "0.20", true],
    ["79.99", "100.00", "0.20", false],
    ["100.00", "100.00", "0.01", true],
  ])("estimate %s vs actual %s at %s → %s", (e, a, t, expected) => {
    expect(isWithinTolerance(e, a, t)).toBe(expected);
  });

  it.each([
    ["abc", "100.00", "0.20"],
    ["100.00", "0.00", "0.20"],
    ["100.00", "-5.00", "0.20"],
    ["100.00", "100.00", "x"],
    [null, "100.00", "0.20"],
  ])("invalid input (%s, %s, %s) is null, never a pass", (e, a, t) => {
    expect(isWithinTolerance(e, a, t as string)).toBeNull();
  });
});

const obs = (i: number, over: Partial<EstimateObservation> = {}): EstimateObservation => ({
  id: `lead-${i}`,
  estimate: "100.00",
  actual: "100.00",
  categorySlug: "fontaneria",
  provinceCode: "28",
  confidenceBand: "MEDIUM",
  questionnaireVersion: null,
  calibrationVersion: "v1",
  ...over,
});
const options = { toleranceRelative: "0.20", targetRate: "0.90", minimumSample: 30 };

describe("M164 — holdout split", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => ({ id: `lead-${i}` }));

  it("is deterministic and partitions the data without overlap", () => {
    const a = splitObservations(ids, "seed-1", 20);
    const b = splitObservations(ids, "seed-1", 20);
    expect(a).toEqual(b);
    expect(a.tuning.length + a.holdout.length).toBe(ids.length);
    expect(() => assertNoLeakage(a.tuning.map((x) => x.id), a.holdout.map((x) => x.id))).not.toThrow();
  });

  it("holds out roughly the requested share and a different seed gives a different split", () => {
    const a = splitObservations(ids, "seed-1", 20);
    expect(a.holdout.length).toBeGreaterThan(150);
    expect(a.holdout.length).toBeLessThan(250);
    expect(splitObservations(ids, "seed-2", 20).holdout.map((x) => x.id)).not.toEqual(a.holdout.map((x) => x.id));
  });

  it("an id's membership never depends on the other ids", () => {
    expect(isHoldout("lead-7", "s", 30)).toBe(isHoldout("lead-7", "s", 30));
  });

  it("leakage between tuning and evaluation is refused", () => {
    expect(() => assertNoLeakage(["a", "b"], ["b", "c"])).toThrow();
  });
});

describe("M164 — accuracy report and verdicts (no 90% claim without evidence)", () => {
  it("no data → NO_DATA, never a rate", () => {
    const r = evaluateEstimateAccuracy([], options);
    expect(r.verdict).toBe("NO_DATA");
    expect(r.overall.n).toBe(0);
    expect(r.overall.meetsTarget).not.toBe(true);
  });

  it("a small perfect sample is INSUFFICIENT_SAMPLE, not success", () => {
    const r = evaluateEstimateAccuracy(Array.from({ length: 5 }, (_, i) => obs(i)), options);
    expect(r.verdict).toBe("INSUFFICIENT_SAMPLE");
  });

  it("a large sample at 100% within tolerance meets the target", () => {
    const r = evaluateEstimateAccuracy(Array.from({ length: 200 }, (_, i) => obs(i)), options);
    expect(r.overall.rate).toBe("1.0000");
    expect(r.verdict).toBe("TARGET_MET");
  });

  it("a large sample below the target is TARGET_NOT_MET", () => {
    const rows = Array.from({ length: 200 }, (_, i) => obs(i, i % 2 === 0 ? { actual: "300.00" } : {}));
    const r = evaluateEstimateAccuracy(rows, options);
    expect(r.overall.rate).toBe("0.5000");
    expect(r.verdict).toBe("TARGET_NOT_MET");
  });

  it("a good aggregate hiding a failing stratum is AGGREGATE_ONLY, never TARGET_MET", () => {
    const good = Array.from({ length: 600 }, (_, i) => obs(i));
    const bad = Array.from({ length: 40 }, (_, i) => obs(1000 + i, { categorySlug: "electricidad", actual: "400.00" }));
    const r = evaluateEstimateAccuracy([...good, ...bad], options);
    expect(r.strata.category.electricidad!.meetsTarget).toBe(false);
    expect(r.verdict).toBe("AGGREGATE_ONLY");
  });

  it("strata below the minimum sample are reported but not judged", () => {
    const rows = [...Array.from({ length: 200 }, (_, i) => obs(i)), ...Array.from({ length: 3 }, (_, i) => obs(500 + i, { provinceCode: "07" }))];
    const r = evaluateEstimateAccuracy(rows, options);
    expect(r.strata.province["07"]!.sufficient).toBe(false);
    expect(r.strata.province["07"]!.meetsTarget).toBeNull();
  });

  it("invalid observations are counted, excluded and never counted as passes", () => {
    const rows = [...Array.from({ length: 100 }, (_, i) => obs(i)), obs(900, { actual: "zero" }), obs(901, { estimate: "" })];
    const r = evaluateEstimateAccuracy(rows, options);
    expect(r.invalidObservations).toBe(2);
    expect(r.overall.n).toBe(100);
  });

  it("is deterministic", () => {
    const rows = Array.from({ length: 80 }, (_, i) => obs(i, { actual: i % 7 === 0 ? "250.00" : "100.00" }));
    expect(JSON.stringify(evaluateEstimateAccuracy(rows, options))).toBe(JSON.stringify(evaluateEstimateAccuracy(rows, options)));
  });
});

describe("M164 — outcome recording validation", () => {
  it("accepts a positive value with at most two decimals and trims the note", () => {
    expect(normalizeLeadEstimateOutcome({ actualJobValue: "250.50", note: "  final invoice  " })).toEqual({ actualJobValue: "250.50", note: "final invoice" });
    expect(normalizeLeadEstimateOutcome({ actualJobValue: "10" }).note).toBeNull();
  });

  it.each(["0", "0.00", "-1.00", "12.345", "abc", "", null, undefined, 100, "1e3"])("rejects value %s", (value) => {
    expect(() => normalizeLeadEstimateOutcome({ actualJobValue: value })).toThrow(LeadEstimateOutcomeRejectedError);
  });

  it("rejects control characters and oversized notes", () => {
    expect(() => normalizeLeadEstimateOutcome({ actualJobValue: "10.00", note: "a\u0000b" })).toThrow(LeadEstimateOutcomeRejectedError);
    expect(() => normalizeLeadEstimateOutcome({ actualJobValue: "10.00", note: "x".repeat(501) })).toThrow(LeadEstimateOutcomeRejectedError);
    expect(() => normalizeLeadEstimateOutcome(null)).toThrow(LeadEstimateOutcomeRejectedError);
  });
});

describe("M164 — review fingerprint binds a decision to its exact inputs", () => {
  const base: ReviewFingerprintInput = {
    leadId: "lead-1",
    categorySlug: "fontaneria",
    parentCategorySlug: null,
    provinceCode: "28",
    scopeState: "STRUCTURED",
    scope: { questionnaireVersion: "q-v1", answers: { size: "SMALL", rooms: 2 } },
    calibrationVersion: "cal-v1",
  };

  it("is a sha256 hex digest and deterministic", () => {
    const fp = computeReviewInputFingerprint(base);
    expect(fp).toMatch(REVIEW_FINGERPRINT_PATTERN);
    expect(computeReviewInputFingerprint({ ...base })).toBe(fp);
  });

  it("does not depend on answer key order", () => {
    const reordered = { ...base, scope: { questionnaireVersion: "q-v1", answers: { rooms: 2, size: "SMALL" } } };
    expect(computeReviewInputFingerprint(reordered)).toBe(computeReviewInputFingerprint(base));
  });

  it.each<[string, Partial<ReviewFingerprintInput>]>([
    ["lead", { leadId: "lead-2" }],
    ["category", { categorySlug: "electricidad" }],
    ["parent category", { parentCategorySlug: "hogar" }],
    ["province", { provinceCode: "08" }],
    ["scope state", { scopeState: "CONFLICTING" }],
    ["answers", { scope: { questionnaireVersion: "q-v1", answers: { size: "LARGE", rooms: 2 } } }],
    ["questionnaire version", { scope: { questionnaireVersion: "q-v2", answers: { size: "SMALL", rooms: 2 } } }],
    ["calibration version", { calibrationVersion: "cal-v2" }],
  ])("changes when the %s changes (a stale approval cannot carry over)", (_n, over) => {
    expect(computeReviewInputFingerprint({ ...base, ...over })).not.toBe(computeReviewInputFingerprint(base));
  });
});

describe("M164 — review decision validation and authorization", () => {
  it("normalizes approvals and rejections", () => {
    expect(normalizeLeadPricingReviewDecision({ outcome: "APPROVED", reviewedJobValue: "450.00", note: " ok " })).toEqual({ outcome: "APPROVED", reviewedJobValue: "450.00", note: "ok" });
    expect(normalizeLeadPricingReviewDecision({ outcome: "REJECTED" })).toEqual({ outcome: "REJECTED", note: null });
  });

  it.each([null, "x", {}, { outcome: "MAYBE" }, { outcome: "APPROVED" }, { outcome: "APPROVED", reviewedJobValue: 450 }, { outcome: "APPROVED", reviewedJobValue: "450.001" }, { outcome: "APPROVED", reviewedJobValue: "-4" }, { outcome: "REJECTED", note: 5 }])(
    "rejects malformed decision %j",
    (value) => {
      expect(() => normalizeLeadPricingReviewDecision(value)).toThrow(LeadPricingReviewRejectedError);
    },
  );

  it("administrators must be ACTIVE and ADMIN or SUPER_ADMIN", () => {
    expect(isReviewableAdmin({ status: "ACTIVE", roles: ["ADMIN"] })).toBe(true);
    expect(isReviewableAdmin({ status: "ACTIVE", roles: ["SUPER_ADMIN"] })).toBe(true);
    expect(isReviewableAdmin({ status: "SUSPENDED", roles: ["ADMIN"] })).toBe(false);
    expect(isReviewableAdmin({ status: "ACTIVE", roles: ["PROFESSIONAL"] })).toBe(false);
    expect(isReviewableAdmin({ status: "ACTIVE", roles: "ADMIN" })).toBe(false);
    expect(isReviewableAdmin(null)).toBe(false);
  });

  it("only a pending review can be decided; a decision is final", () => {
    expect(canDecideLeadPricingReview("PENDING_REVIEW")).toBe(true);
    for (const s of ["APPROVED", "REJECTED", "SUPERSEDED"] as const) expect(canDecideLeadPricingReview(s)).toBe(false);
  });

  it("validates review ids as uuids", () => {
    expect(isLeadPricingReviewUuid("3f2b8a52-1c7e-4d0a-9a43-0b6f6e1c9d10")).toBe(true);
    for (const bad of ["", "abc", null, 5, "3f2b8a52-1c7e-4d0a-9a43-0b6f6e1c9d1"]) expect(isLeadPricingReviewUuid(bad)).toBe(false);
  });
});

describe("M164 — customer messaging is truthful", () => {
  it("under-review error has a stable code and says plainly it is not yet priced or published and quotes no amount", () => {
    const e = new LeadPricingUnderReviewError();
    expect(e.code).toBe("LEAD_PRICING_UNDER_REVIEW");
    expect(e.message).toMatch(/not been (confirmed|published)|has not been published/i);
    expect(e.message).not.toMatch(/guarantee|€|EUR|\d/i);
  });
});
