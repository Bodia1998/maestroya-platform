import { describe, expect, it, vi } from "vitest";

import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import type { LeadScopeAnswersReader, StoredLeadScope } from "@/application/ports/lead-scope-answers-reader";
import { ConfiguredLeadPublicationPriceSource } from "@/application/services/lead-pricing/configured-lead-publication-price-source";
import { EstimatedValueLeadPricingContextReader } from "@/application/services/lead-pricing/estimated-value-lead-pricing-context-reader";
import type { JobValueEstimationContext } from "@/domain/services/job-value-estimation";
import { validateLeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { evaluateLeadPublicationPricing } from "@/domain/services/lead-publication";
import { JOB_VALUE_ESTIMATION_CONFIG_V1 } from "@/infrastructure/pricing/job-value-estimation-config.v1";
import { LEAD_PRICING_PILOT_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import { TEST_SCOPE_REGISTRY, TEST_SCOPE_REGISTRY_V2 } from "../../../../../test-utils/scope-questionnaire-fixtures";

/** Module 163 — stored scope through the real estimator wiring: reproducibility, version isolation, tamper and fail-closed handling. */
const ctx = (patch: Partial<JobValueEstimationContext> = {}): JobValueEstimationContext => ({ flowVersion: "LEAD_V1", categorySlug: "fontaneria", parentCategorySlug: null, urgency: "MEDIUM", ...patch });
const contexts = (c: JobValueEstimationContext | null): JobValueEstimationContextReader => ({ findByLeadId: vi.fn(async () => c) });
const store = (s: StoredLeadScope | null): LeadScopeAnswersReader => ({ findByLeadId: vi.fn(async () => s) });
const STORED: StoredLeadScope = { questionnaireVersion: "test-scope-v1", answers: { size: "large" } };
const resolution = validateLeadPricingProductionConfig(LEAD_PRICING_PILOT_CONFIG_V1);
if (resolution.status !== "VALID") throw new Error("pilot config must be valid");

const reader = (c: JobValueEstimationContext | null, s: StoredLeadScope | null, registry = TEST_SCOPE_REGISTRY, withSource = true) =>
  new EstimatedValueLeadPricingContextReader(contexts(c), resolution.config.jobValue, withSource ? { reader: store(s), registry } : undefined);

describe("EstimatedValueLeadPricingContextReader — stored structured scope", () => {
  it("no stored scope: identical to the pre-M163 result, no scope key", async () => {
    const r = await reader(ctx(), null).findByLeadId("l");
    expect(r?.estimatedServiceValue).toEqual({ amount: "150.00", currency: "EUR", confidence: "LOW" });
    expect(r).not.toHaveProperty("scope");
  });

  it("valid stored scope refines the estimate (150 x 3 x 2 = 900.00), keeps confidence, and reports the provenance", async () => {
    const r = await reader(ctx(), STORED).findByLeadId("l");
    expect(r?.estimatedServiceValue).toEqual({ amount: "900.00", currency: "EUR", confidence: "LOW" });
    expect(r?.scope).toEqual({ questionnaireVersion: "test-scope-v1", answers: { size: "large" } });
  });

  it("is reproducible: the same stored scope and definition give byte-identical results", async () => {
    const a = JSON.stringify(await reader(ctx(), STORED).findByLeadId("l"));
    const b = JSON.stringify(await reader(ctx(), STORED).findByLeadId("l"));
    expect(a).toBe(b);
  });

  it("the stored questionnaire version must match the current definition: a newer definition does not silently re-price an old answer set", async () => {
    const r = await reader(ctx(), STORED, TEST_SCOPE_REGISTRY_V2).findByLeadId("l");
    expect(r?.estimatedServiceValue).toBeNull();
    expect(r).not.toHaveProperty("scope");
  });

  it.each([
    ["an unknown option value", { size: "gigantic" }],
    ["an unknown question id", { size: "large", budget: 5000 }],
    ["a missing required answer", {}],
    ["a wrong type", { size: 3 }],
    ["a non-object", "large"],
    ["null answers", null],
  ])("tampered stored answers (%s) make the estimate unavailable — never neutral", async (_l, answers) => {
    const r = await reader(ctx(), { questionnaireVersion: "test-scope-v1", answers }).findByLeadId("l");
    expect(r?.estimatedServiceValue).toBeNull();
  });

  it("stored scope with no questionnaire for the category (e.g. empty registry) is unusable, not ignored", async () => {
    expect((await reader(ctx(), STORED, {}).findByLeadId("l"))?.estimatedServiceValue).toBeNull();
    expect((await reader(ctx({ categorySlug: "electricidad" }), STORED).findByLeadId("l"))?.estimatedServiceValue).toBeNull();
  });

  it("legacy-flow context never uses scope and is never priced from it", async () => {
    const r = await reader(ctx({ flowVersion: "LEGACY_QUOTE_PAYMENT" }), STORED).findByLeadId("l");
    expect(r?.estimatedServiceValue).toBeNull();
  });

  it("without a scope source, stored scope is never consulted", async () => {
    const r = await reader(ctx(), STORED, TEST_SCOPE_REGISTRY, false).findByLeadId("l");
    expect(r?.estimatedServiceValue?.amount).toBe("150.00");
  });

  it("the value ceiling still applies to a scoped estimate (fail closed, not clamped)", async () => {
    const cfg = { ...resolution.config.jobValue, maximumValue: "500.00" };
    const r = await new EstimatedValueLeadPricingContextReader(contexts(ctx()), cfg, { reader: store(STORED), registry: TEST_SCOPE_REGISTRY }).findByLeadId("l");
    expect(r?.estimatedServiceValue).toBeNull();
  });

  it("an absent context is null", async () => {
    expect(await reader(null, STORED).findByLeadId("l")).toBeNull();
  });

  it("uses the real default job-value configuration shape (guard against fixture drift)", () => {
    expect(JOB_VALUE_ESTIMATION_CONFIG_V1.ruleVersion).toBeTruthy();
  });
});

describe("ConfiguredLeadPublicationPriceSource — scope provenance", () => {
  const source = (s: StoredLeadScope | null, registry = TEST_SCOPE_REGISTRY) =>
    new ConfiguredLeadPublicationPriceSource(contexts(ctx()), resolution, { reader: store(s), registry });

  it("prices from the refined estimate and carries the provenance beside (not inside) the pricing result", async () => {
    const outcome = await source(STORED).priceForLead("l");
    expect(outcome).toMatchObject({ kind: "RESOLVED", scope: { questionnaireVersion: "test-scope-v1", answers: { size: "large" } } });
    const evaluation = evaluateLeadPublicationPricing(outcome);
    expect(evaluation.ok && evaluation.pricing).toMatchObject({ estimatedJobValue: "900.00", price: "108.00" });
    expect(JSON.stringify((outcome as { result: unknown }).result)).not.toMatch(/test-scope|size|large/);
  });

  it("no stored scope: outcome has no scope key and prices as before", async () => {
    const outcome = await source(null).priceForLead("l");
    expect(outcome).not.toHaveProperty("scope");
    const evaluation = evaluateLeadPublicationPricing(outcome);
    expect(evaluation.ok && evaluation.pricing).toMatchObject({ estimatedJobValue: "150.00", price: "18.00" });
  });

  it("unusable stored scope leaves the lead UNPRICED", async () => {
    expect(evaluateLeadPublicationPricing(await source(STORED, {}).priceForLead("l")).ok).toBe(false);
    expect(evaluateLeadPublicationPricing(await source({ questionnaireVersion: "old", answers: { size: "large" } }).priceForLead("l")).ok).toBe(false);
  });
});
