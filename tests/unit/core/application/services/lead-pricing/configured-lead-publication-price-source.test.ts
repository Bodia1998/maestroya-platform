import { describe, expect, it, vi } from "vitest";

import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import { ConfiguredLeadPublicationPriceSource } from "@/application/services/lead-pricing/configured-lead-publication-price-source";
import type { JobValueEstimationContext } from "@/domain/services/job-value-estimation";
import { validateLeadPricingProductionConfig, type LeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { buildLeadPublicationSnapshotData, evaluateLeadPublicationPricing } from "@/domain/services/lead-publication";
import { LEAD_PRICING_PILOT_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import { LEAD_PRICING_TEST_CONFIG } from "../../../../../test-utils/pricing/lead-pricing-test-config";
import { TEST_BUYER_POLICY } from "../../../../../test-utils/lead-publication-fixtures";

const ctx = (patch: Partial<JobValueEstimationContext> = {}): JobValueEstimationContext => ({ flowVersion: "LEAD_V1", categorySlug: "fontaneria", parentCategorySlug: null, urgency: "MEDIUM", ...patch });
const reader = (c: JobValueEstimationContext | null): JobValueEstimationContextReader => ({ findByLeadId: vi.fn(async () => c) });
const valid = (config: LeadPricingProductionConfig = LEAD_PRICING_PILOT_CONFIG_V1) => validateLeadPricingProductionConfig(config);

async function gate(c: JobValueEstimationContext | null, resolution = valid()) {
  return evaluateLeadPublicationPricing(await new ConfiguredLeadPublicationPriceSource(reader(c), resolution).priceForLead("lead-1"));
}

describe("ConfiguredLeadPublicationPriceSource + priceability gate (real M132 pilot configuration)", () => {
  it("prices a supported pilot category and reports the configuration identity", async () => {
    const outcome = await new ConfiguredLeadPublicationPriceSource(reader(ctx()), valid()).priceForLead("lead-1");
    expect(outcome).toMatchObject({ kind: "RESOLVED", configVersion: "lead-pricing-pilot-v1", jobValueRuleVersion: "job-value-pilot-v1.1" });
    const evaluation = evaluateLeadPublicationPricing(outcome);
    expect(evaluation.ok && evaluation.pricing).toMatchObject({ price: "18.00", currency: "EUR", estimatedJobValue: "150.00", pricingRate: "0.12", pricingRuleVersion: "lead-pricing-pilot-v1.1" });
  });

  it("explicitly unsupported category (reformas) is rejected, never priced", async () => {
    expect(await gate(ctx({ categorySlug: "reformas" }))).toEqual({ ok: false, reason: "CATEGORY_UNSUPPORTED" });
  });

  it("a category with no configuration, or a legacy-flow context, is rejected", async () => {
    expect((await gate(ctx({ categorySlug: "jardineria" }))).ok).toBe(false);
    expect(await gate(ctx({ flowVersion: "LEGACY_QUOTE_PAYMENT" }))).toEqual({ ok: false, reason: "UNPRICED" });
    expect(await gate(null)).toEqual({ ok: false, reason: "UNPRICED" });
  });

  it("confidence below the configured minimum is CONFIDENCE_TOO_LOW (MEDIUM-minimum fixture vs LOW V1 estimate)", async () => {
    const resolution = validateLeadPricingProductionConfig(LEAD_PRICING_TEST_CONFIG, { allowTestOnly: true });
    expect(resolution.status).toBe("VALID");
    expect(await gate(ctx(), resolution)).toEqual({ ok: false, reason: "CONFIDENCE_TOO_LOW" });
  });

  it("missing / invalid / test-only configuration fails closed without running the engine", async () => {
    const bad = [
      validateLeadPricingProductionConfig(undefined),
      validateLeadPricingProductionConfig({ ...LEAD_PRICING_PILOT_CONFIG_V1, currency: "USD" }),
      validateLeadPricingProductionConfig(LEAD_PRICING_TEST_CONFIG),
    ];
    for (const resolution of bad) {
      expect(resolution.status).not.toBe("VALID");
      const r = reader(ctx());
      const outcome = await new ConfiguredLeadPublicationPriceSource(r, resolution).priceForLead("lead-1");
      expect(outcome).toEqual({ kind: "CONFIGURATION_UNAVAILABLE" });
      expect(r.findByLeadId).not.toHaveBeenCalled();
      expect(evaluateLeadPublicationPricing(outcome)).toEqual({ ok: false, reason: "PRICING_CONFIGURATION_UNAVAILABLE" });
    }
  });

  it("the snapshot is a value copy: a later configuration change cannot alter it", async () => {
    const outcome = await new ConfiguredLeadPublicationPriceSource(reader(ctx()), valid()).priceForLead("lead-1");
    const evaluation = evaluateLeadPublicationPricing(outcome);
    if (!evaluation.ok) throw new Error("expected pass");
    const snapshot = buildLeadPublicationSnapshotData(evaluation.pricing, TEST_BUYER_POLICY);
    const before = JSON.stringify(snapshot);

    // a new released configuration with different rates + versions prices the same lead differently...
    const changed = validateLeadPricingProductionConfig({
      ...LEAD_PRICING_PILOT_CONFIG_V1,
      configVersion: "lead-pricing-pilot-v2",
      jobValue: { ...LEAD_PRICING_PILOT_CONFIG_V1.jobValue, ruleVersion: "job-value-pilot-v2" },
      leadPricing: { ...LEAD_PRICING_PILOT_CONFIG_V1.leadPricing, ruleVersion: "lead-pricing-pilot-v2", rateBySlug: { ...LEAD_PRICING_PILOT_CONFIG_V1.leadPricing.rateBySlug, fontaneria: "0.20" } },
    });
    const next = evaluateLeadPublicationPricing(await new ConfiguredLeadPublicationPriceSource(reader(ctx()), changed).priceForLead("lead-1"));
    expect(next.ok && next.pricing.price).toBe("30.00");
    // ...but the already-built snapshot is untouched (and frozen configs cannot be mutated underneath it).
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(snapshot).toMatchObject({ price: "18.00", pricingConfigVersion: "lead-pricing-pilot-v1" });
  });
});
