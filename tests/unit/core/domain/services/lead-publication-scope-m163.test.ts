import { describe, expect, it } from "vitest";

import { buildLeadPublicationSnapshotData, evaluateLeadPublicationPricing, isValidLeadPublicationSnapshotData } from "@/domain/services/lead-publication";
import { SNAPSHOT_DATA, TEST_BUYER_POLICY, pricedOutcome } from "../../../../test-utils/lead-publication-fixtures";

/** Module 163 — scope provenance in the publication contract (M133 shape preserved when absent). */
const SCOPE = { questionnaireVersion: "test-scope-v1", answers: { size: "large", rooms: 3 } };

describe("evaluateLeadPublicationPricing — scope provenance", () => {
  it("no scope: pricing has no scope keys (exact pre-M163 shape)", () => {
    const e = evaluateLeadPublicationPricing(pricedOutcome());
    expect(e.ok && Object.keys(e.pricing).sort()).toEqual(["currency", "estimatedJobValue", "jobValueRuleVersion", "price", "pricingConfidence", "pricingConfigVersion", "pricingRate", "pricingRuleVersion"].sort());
  });
  it.each([undefined, null])("scope %j is treated as absent", (scope) => {
    const e = evaluateLeadPublicationPricing(pricedOutcome({ scope } as never));
    expect(e.ok && e.pricing).not.toHaveProperty("scopeAnswers");
  });
  it("valid scope flows into the pricing as a copy (version + answers together)", () => {
    const e = evaluateLeadPublicationPricing(pricedOutcome({ scope: SCOPE }));
    expect(e.ok && e.pricing).toMatchObject({ scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { size: "large", rooms: 3 } });
    if (e.ok) expect(e.pricing.scopeAnswers).not.toBe(SCOPE.answers);
  });
  it.each([
    ["empty answers", { questionnaireVersion: "v1", answers: {} }],
    ["no version", { answers: { a: "b" } }],
    ["no answers", { questionnaireVersion: "v1" }],
    ["nested answer", { questionnaireVersion: "v1", answers: { a: { b: 1 } } }],
    ["a string", "scope"],
  ])("malformed scope (%s) is PRICING_RESULT_MALFORMED — never dropped", (_l, scope) => {
    expect(evaluateLeadPublicationPricing(pricedOutcome({ scope: scope as never }))).toEqual({ ok: false, reason: "PRICING_RESULT_MALFORMED" });
  });
});

describe("snapshot validity — scope provenance", () => {
  const withScope = { ...SNAPSHOT_DATA, scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { size: "large" } };
  it("accepts a snapshot without scope and one with both", () => {
    expect(isValidLeadPublicationSnapshotData(SNAPSHOT_DATA)).toBe(true);
    expect(isValidLeadPublicationSnapshotData(withScope)).toBe(true);
  });
  it.each([
    ["version only", { ...SNAPSHOT_DATA, scopeQuestionnaireVersion: "test-scope-v1" }],
    ["answers only", { ...SNAPSHOT_DATA, scopeAnswers: { size: "large" } }],
    ["empty answers", { ...withScope, scopeAnswers: {} }],
    ["bad version", { ...withScope, scopeQuestionnaireVersion: "Not A Version" }],
    ["nested answers", { ...withScope, scopeAnswers: { a: { b: 1 } } }],
  ])("rejects %s", (_l, data) => {
    expect(isValidLeadPublicationSnapshotData(data)).toBe(false);
  });
  it("buildLeadPublicationSnapshotData carries the scope and the buyer policy", () => {
    const e = evaluateLeadPublicationPricing(pricedOutcome({ scope: SCOPE }));
    if (!e.ok) throw new Error("expected ok");
    const data = buildLeadPublicationSnapshotData(e.pricing, TEST_BUYER_POLICY);
    expect(data).toMatchObject({ scopeQuestionnaireVersion: "test-scope-v1", maxBuyers: 2, buyerPolicyVersion: TEST_BUYER_POLICY.policyVersion });
    expect(isValidLeadPublicationSnapshotData(data)).toBe(true);
  });
});
