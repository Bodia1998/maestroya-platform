import { describe, expect, it } from "vitest";

import { InvalidLeadFlowError, LeadNotPublishableError, ServiceRequestNotEligibleForLeadError, isLeadAvailableForMarketplace } from "@/domain/services/lead";
import {
  LeadPublicationRejectedError,
  MAX_LEAD_BUYERS_LIMIT,
  assertLeadPublicationEligible,
  assertValidLeadPublicationSnapshotData,
  buildLeadPublicationSnapshotData,
  evaluateLeadPublicationPricing,
  isLeadMarketplaceReady,
  isLeadOpenForAdditionalPurchases,
  isLeadPublicationSnapshotComplete,
  isValidLeadBuyerPolicy,
} from "@/domain/services/lead-publication";

import { PRICED_RESULT, SNAPSHOT_DATA, TEST_BUYER_POLICY, pricedOutcome, unpricedOutcome } from "../../../../test-utils/lead-publication-fixtures";

const reason = (outcome: unknown) => {
  const r = evaluateLeadPublicationPricing(outcome);
  return r.ok ? "OK" : r.reason;
};

describe("priceability gate", () => {
  it("PRICED passes and preserves exact decimal values and identities", () => {
    const r = evaluateLeadPublicationPricing(pricedOutcome());
    expect(r).toEqual({
      ok: true,
      pricing: {
        price: "18.00", currency: "EUR", estimatedJobValue: "150.00", pricingRate: "0.12", pricingConfidence: "LOW",
        pricingConfigVersion: "lead-pricing-test-config-v1", jobValueRuleVersion: "job-value-test-v1", pricingRuleVersion: "lead-pricing-test-v1",
      },
    });
  });

  it("normalises decimal strings without floating point", () => {
    const r = evaluateLeadPublicationPricing(pricedOutcome({ result: { ...PRICED_RESULT, price: "0.1", estimatedServiceValue: "1234.5", rate: "0.125" } as never }));
    expect(r.ok && r.pricing).toMatchObject({ price: "0.10", estimatedJobValue: "1234.50", pricingRate: "0.125" });
  });

  it.each([
    ["UNPRICED / SERVICE_VALUE_UNAVAILABLE", unpricedOutcome("UNPRICED", "SERVICE_VALUE_UNAVAILABLE"), "UNPRICED"],
    ["UNPRICED / RATE_NOT_CONFIGURED", unpricedOutcome("UNPRICED", "RATE_NOT_CONFIGURED"), "UNPRICED"],
    ["UNPRICED / NOT_LEAD_V1", unpricedOutcome("UNPRICED", "NOT_LEAD_V1"), "UNPRICED"],
    ["CATEGORY_UNSUPPORTED", unpricedOutcome("UNPRICED", "CATEGORY_UNSUPPORTED"), "CATEGORY_UNSUPPORTED"],
    ["CONFIDENCE_TOO_LOW", unpricedOutcome("UNPRICED", "CONFIDENCE_TOO_LOW"), "CONFIDENCE_TOO_LOW"],
    ["INVALID_INPUT / INVALID_SERVICE_VALUE", unpricedOutcome("INVALID_INPUT", "INVALID_SERVICE_VALUE"), "PRICING_INPUT_INVALID"],
    ["INVALID_INPUT / INVALID_CONFIGURATION", unpricedOutcome("INVALID_INPUT", "INVALID_CONFIGURATION"), "PRICING_CONFIGURATION_INVALID"],
    ["missing/invalid configuration", { kind: "CONFIGURATION_UNAVAILABLE" }, "PRICING_CONFIGURATION_UNAVAILABLE"],
  ])("rejects %s", (_n, outcome, expected) => expect(reason(outcome)).toBe(expected));

  it("rejects an unknown status and every malformed result (fail closed)", () => {
    const base = { kind: "RESOLVED", configVersion: "c1", jobValueRuleVersion: "j1" };
    const malformed: unknown[] = [
      undefined, null, "PRICED", 42, [], {}, { kind: "OTHER" },
      { ...base, result: undefined }, { ...base, result: null }, { ...base, result: { status: "MAYBE" } }, { ...base, result: {} },
      { ...base, configVersion: "", result: PRICED_RESULT }, { ...base, jobValueRuleVersion: undefined, result: PRICED_RESULT },
      { ...base, result: { ...PRICED_RESULT, price: "0.00" } },
      { ...base, result: { ...PRICED_RESULT, price: "-1.00" } },
      { ...base, result: { ...PRICED_RESULT, price: 18 } },
      { ...base, result: { ...PRICED_RESULT, price: "18.001" } },
      { ...base, result: { ...PRICED_RESULT, price: "1e2" } },
      { ...base, result: { ...PRICED_RESULT, price: "NaN" } },
      { ...base, result: { ...PRICED_RESULT, price: undefined } },
      { ...base, result: { ...PRICED_RESULT, price: "100000000.00" } },
      { ...base, result: { ...PRICED_RESULT, currency: "USD" } },
      { ...base, result: { ...PRICED_RESULT, estimatedServiceValue: "0.00" } },
      { ...base, result: { ...PRICED_RESULT, estimatedServiceValue: null } },
      { ...base, result: { ...PRICED_RESULT, rate: "0" } },
      { ...base, result: { ...PRICED_RESULT, rate: "1.5" } },
      { ...base, result: { ...PRICED_RESULT, confidence: "CERTAIN" } },
      { ...base, result: { ...PRICED_RESULT, ruleVersion: "" } },
    ];
    for (const m of malformed) expect(reason(m), JSON.stringify(m)).toBe("PRICING_RESULT_MALFORMED");
  });

  it("never throws", () => {
    expect(() => evaluateLeadPublicationPricing(Symbol("x") as never)).not.toThrow();
  });
});

describe("buyer policy", () => {
  it("is explicit: a version slug and an integer maxBuyers >= 1", () => {
    expect(isValidLeadBuyerPolicy(TEST_BUYER_POLICY)).toBe(true);
    expect(isValidLeadBuyerPolicy({ policyVersion: "p1", maxBuyers: 1 })).toBe(true);
    expect(isValidLeadBuyerPolicy({ policyVersion: "p1", maxBuyers: MAX_LEAD_BUYERS_LIMIT })).toBe(true);
  });

  it.each([
    undefined, null, {}, { policyVersion: "p1" }, { maxBuyers: 1 },
    { policyVersion: "p1", maxBuyers: 0 }, { policyVersion: "p1", maxBuyers: -1 }, { policyVersion: "p1", maxBuyers: 1.5 },
    { policyVersion: "p1", maxBuyers: "2" }, { policyVersion: "p1", maxBuyers: null }, { policyVersion: "p1", maxBuyers: Number.NaN },
    { policyVersion: "p1", maxBuyers: Infinity }, { policyVersion: "p1", maxBuyers: MAX_LEAD_BUYERS_LIMIT + 1 },
    { policyVersion: "", maxBuyers: 1 }, { policyVersion: "Has Spaces", maxBuyers: 1 },
  ])("rejects %j", (candidate) => expect(isValidLeadBuyerPolicy(candidate)).toBe(false));

  it("expresses whether a published lead can still take another purchase (policy only, not enforcement)", () => {
    expect(isLeadOpenForAdditionalPurchases({ maxBuyers: 2 }, 0)).toBe(true);
    expect(isLeadOpenForAdditionalPurchases({ maxBuyers: 2 }, 1)).toBe(true);
    expect(isLeadOpenForAdditionalPurchases({ maxBuyers: 2 }, 2)).toBe(false);
    expect(isLeadOpenForAdditionalPurchases({ maxBuyers: 1 }, 1)).toBe(false);
    expect(isLeadOpenForAdditionalPurchases(null, 0)).toBe(false); // no policy = never open
    expect(isLeadOpenForAdditionalPurchases({ maxBuyers: 2 }, -1)).toBe(false);
  });
});

describe("snapshot", () => {
  it("is built from the validated pricing + buyer policy", () => {
    const evaluation = evaluateLeadPublicationPricing(pricedOutcome());
    if (!evaluation.ok) throw new Error("expected pass");
    expect(buildLeadPublicationSnapshotData(evaluation.pricing, TEST_BUYER_POLICY)).toEqual(SNAPSHOT_DATA);
  });

  it("validates structure and rejects tampered data", () => {
    expect(() => assertValidLeadPublicationSnapshotData(SNAPSHOT_DATA)).not.toThrow();
    for (const bad of [{ ...SNAPSHOT_DATA, price: "0" }, { ...SNAPSHOT_DATA, price: 18 }, { ...SNAPSHOT_DATA, currency: "USD" }, { ...SNAPSHOT_DATA, maxBuyers: 0 }, { ...SNAPSHOT_DATA, buyerPolicyVersion: "" }, { ...SNAPSHOT_DATA, pricingRuleVersion: undefined }, null]) {
      expect(() => assertValidLeadPublicationSnapshotData(bad)).toThrow(LeadPublicationRejectedError);
    }
  });

  it("is complete only with a publication timestamp", () => {
    expect(isLeadPublicationSnapshotComplete({ ...SNAPSHOT_DATA, publishedAt: new Date() })).toBe(true);
    expect(isLeadPublicationSnapshotComplete(SNAPSHOT_DATA)).toBe(false);
    expect(isLeadPublicationSnapshotComplete(null)).toBe(false);
  });
});

describe("pre-publication eligibility", () => {
  const request = { status: "PUBLISHED" as const, title: "t", description: "d", location: { city: "Madrid" } };
  const input = (patch: Record<string, unknown> = {}) => ({ leadStatus: "DRAFT" as const, flowVersion: "LEAD_V1", request, ...patch });

  it("accepts a DRAFT LEAD_V1 lead with an open, complete request", () => {
    expect(() => assertLeadPublicationEligible(input())).not.toThrow();
  });

  it("fails closed for legacy, missing and unknown flow versions", () => {
    for (const flowVersion of ["LEGACY_QUOTE_PAYMENT", null, undefined, "", "lead_v1"]) {
      expect(() => assertLeadPublicationEligible(input({ flowVersion }))).toThrow(InvalidLeadFlowError);
    }
  });

  it("rejects terminal and already-published leads", () => {
    for (const leadStatus of ["CLOSED", "EXPIRED", "CANCELLED", "PUBLISHED"] as const) {
      expect(() => assertLeadPublicationEligible(input({ leadStatus }))).toThrow(LeadNotPublishableError);
    }
  });

  it("rejects a missing/deleted/not-open/incomplete request", () => {
    for (const r of [null, undefined, { ...request, deleted: true }, { ...request, status: "CANCELLED" }, { ...request, status: "DRAFT" }, { ...request, title: " " }, { ...request, location: { city: "" } }]) {
      expect(() => assertLeadPublicationEligible(input({ request: r }))).toThrow(ServiceRequestNotEligibleForLeadError);
    }
  });
});

describe("marketplace readiness (post-publication)", () => {
  const available = { leadStatus: "PUBLISHED" as const, flowVersion: "LEAD_V1", requestStatus: "PUBLISHED" as const };
  const publication = { ...SNAPSHOT_DATA, publishedAt: new Date() };

  it("extends — never redefines — the M130 availability policy", () => {
    expect(isLeadAvailableForMarketplace(available)).toBe(true);
    expect(isLeadMarketplaceReady({ ...available, publication })).toBe(true);
  });

  it("status PUBLISHED + open request is NOT enough without a snapshot (legacy M124 publication)", () => {
    expect(isLeadMarketplaceReady({ ...available, publication: null })).toBe(false);
    expect(isLeadMarketplaceReady({ ...available, publication: undefined })).toBe(false);
    expect(isLeadMarketplaceReady({ ...available, publication: { ...publication, price: "0.00" } })).toBe(false);
  });

  it("a snapshot never makes an unavailable lead ready", () => {
    for (const patch of [{ leadStatus: "CLOSED" }, { flowVersion: "LEGACY_QUOTE_PAYMENT" }, { flowVersion: null }, { requestStatus: "CANCELLED" }, { requestDeleted: true }]) {
      expect(isLeadMarketplaceReady({ ...available, ...patch, publication } as never)).toBe(false);
    }
  });
});
