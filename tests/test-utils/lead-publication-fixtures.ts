import type { LeadPublicationPriceSource } from "@/application/ports/lead-publication-price-source";
import type { LeadRecord } from "@/domain/repositories/lead-repository";
import type { LeadPricingResult } from "@/domain/services/lead-pricing";
import type { LeadBuyerPolicy, LeadPublicationPriceOutcome, LeadPublicationSnapshotData } from "@/domain/services/lead-publication";

/** Module 133 test fixtures (tests only; production never imports these). */
export const TEST_BUYER_POLICY: LeadBuyerPolicy = { policyVersion: "lead-buyer-policy-test-v1", maxBuyers: 2 };

export const PRICED_RESULT: LeadPricingResult = {
  status: "PRICED",
  price: "18.00",
  currency: "EUR",
  confidence: "LOW",
  estimatedServiceValue: "150.00",
  rate: "0.12",
  rateSource: "CATEGORY",
  factors: { complexity: "1.0", urgency: "1.0", leadQuality: "1.0", market: "1.0" },
  uncappedPrice: "18.00",
  capApplied: null,
  ruleVersion: "lead-pricing-test-v1",
};

export const pricedOutcome = (patch: Partial<Extract<LeadPublicationPriceOutcome, { kind: "RESOLVED" }>> = {}): LeadPublicationPriceOutcome => ({
  kind: "RESOLVED",
  configVersion: "lead-pricing-test-config-v1",
  jobValueRuleVersion: "job-value-test-v1",
  result: PRICED_RESULT,
  ...patch,
});

export const unpricedOutcome = (status: "UNPRICED" | "INVALID_INPUT", reason: string): LeadPublicationPriceOutcome => ({
  kind: "RESOLVED",
  configVersion: "lead-pricing-test-config-v1",
  jobValueRuleVersion: "job-value-test-v1",
  result: { status, reason, ruleVersion: "lead-pricing-test-v1" } as LeadPricingResult,
});

export const SNAPSHOT_DATA: LeadPublicationSnapshotData = {
  price: "18.00",
  currency: "EUR",
  estimatedJobValue: "150.00",
  pricingRate: "0.12",
  pricingConfidence: "LOW",
  pricingConfigVersion: "lead-pricing-test-config-v1",
  jobValueRuleVersion: "job-value-test-v1",
  pricingRuleVersion: "lead-pricing-test-v1",
  buyerPolicyVersion: "lead-buyer-policy-test-v1",
  maxBuyers: 2,
};

export const fixedPriceSource = (outcome: LeadPublicationPriceOutcome | (() => LeadPublicationPriceOutcome)): LeadPublicationPriceSource & { calls: number } => {
  const source = {
    calls: 0,
    async priceForLead() {
      source.calls += 1;
      return typeof outcome === "function" ? outcome() : outcome;
    },
  };
  return source;
};

/** What the conditional write does to a row (fakes only): status + snapshot + maxBuyers together. */
export function withSnapshot(row: LeadRecord, data: LeadPublicationSnapshotData, publishedAt = new Date("2026-10-06T10:00:00Z")): LeadRecord {
  return { ...row, status: "PUBLISHED", maxBuyers: data.maxBuyers, publication: { ...data, publishedAt } };
}
