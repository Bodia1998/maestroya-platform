import { describe, expect, it, vi } from "vitest";

import type { LeadScopeAnswersReader } from "@/application/ports/lead-scope-answers-reader";
import { ConfiguredLeadPublicationPriceSource } from "@/application/services/lead-pricing/configured-lead-publication-price-source";
import { leadRequestSchema } from "@/application/dto/lead-request.dto";
import { CreateLeadV1ServiceRequestUseCase } from "@/application/use-cases/lead/create-lead-v1-service-request.use-case";
import { SubmitLeadRequestUseCase } from "@/application/use-cases/lead-request/submit-lead-request.use-case";
import type { CreateServiceRequestData } from "@/domain/repositories/service-request-repository";
import type { LeadRequestCategoryRepository } from "@/domain/repositories/lead-request-category-repository";
import { leadRequestCategoryPolicyFrom } from "@/domain/services/lead-request-category-support";
import { buildLeadPublicationSnapshotData, evaluateLeadPublicationPricing, isValidLeadPublicationSnapshotData } from "@/domain/services/lead-publication";
import { validateLeadPricingProductionConfig } from "@/domain/services/lead-pricing-production-config";
import { LEAD_PRICING_PILOT_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-pilot-config.v1";
import { resolveLeadPricingProductionConfig } from "@/infrastructure/pricing/lead-pricing-production-config-resolver";
import { TEST_BUYER_POLICY } from "../../../../../test-utils/lead-publication-fixtures";
import { TEST_SCOPE_REGISTRY, TEST_SCOPE_REGISTRY_V2 } from "../../../../../test-utils/scope-questionnaire-fixtures";

/** Module 163 — end to end, in memory: submit -> stored provenance -> publication price source -> immutable snapshot data. */
const CAT = { id: "123e4567-e89b-42d3-a456-426614174001", name: "Fontanería", slug: "fontaneria", parentSlug: null };
const categories: LeadRequestCategoryRepository = { listActive: async () => [CAT], findActiveById: async (id) => (id === CAT.id ? CAT : null) };
const policy = leadRequestCategoryPolicyFrom(resolveLeadPricingProductionConfig("lead-pricing-pilot-v1"));
const resolution = validateLeadPricingProductionConfig(LEAD_PRICING_PILOT_CONFIG_V1);

function world() {
  const stored: { data: CreateServiceRequestData | null } = { data: null };
  const requests = { create: vi.fn(async (_c: string, _u: string, d: CreateServiceRequestData) => { stored.data = d; return { id: "sr-1", ...d }; }) };
  const create = new CreateLeadV1ServiceRequestUseCase(
    requests as never,
    { findOrCreateByUserId: vi.fn(async () => ({ id: "cust" })) } as never,
    { findActiveByIds: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))) } as never,
    { geocode: vi.fn(async () => null) } as never,
    { execute: vi.fn(async () => ({ id: "lead-1" })) } as never,
  );
  const submit = new SubmitLeadRequestUseCase(categories, policy, create, { execute: vi.fn(async () => ({ id: "lead-1" })) } as never, undefined, TEST_SCOPE_REGISTRY);
  const reader: LeadScopeAnswersReader = {
    findByLeadId: async () => (stored.data?.scope ? { questionnaireVersion: stored.data.scope.questionnaireVersion, answers: JSON.parse(JSON.stringify(stored.data.scope.answers)) } : null),
  };
  const contexts = { findByLeadId: async () => ({ flowVersion: "LEAD_V1" as const, categorySlug: "fontaneria", parentCategorySlug: null, urgency: "MEDIUM" as const }) };
  const price = (registry = TEST_SCOPE_REGISTRY) => new ConfiguredLeadPublicationPriceSource(contexts, resolution, { reader, registry }).priceForLead("lead-1");
  return { submit, stored, price };
}
const input = (extra: Record<string, unknown> = {}) =>
  leadRequestSchema.parse({ categoryId: CAT.id, title: "Fuga en el baño", description: "El grifo del lavabo gotea desde hace dos días.", location: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28001" }, ...extra });

describe("Module 163 — questionnaire version reproducibility", () => {
  it("answers submitted -> stored with the version -> the snapshot carries the same version + answers and the refined price", async () => {
    const w = world();
    await w.submit.execute("u", input({ scopeAnswers: { size: "large" } }));
    expect(w.stored.data?.scope).toEqual({ questionnaireVersion: "test-scope-v1", answers: { size: "large" } });
    const evaluation = evaluateLeadPublicationPricing(await w.price());
    if (!evaluation.ok) throw new Error("expected priced");
    const snapshot = buildLeadPublicationSnapshotData(evaluation.pricing, TEST_BUYER_POLICY);
    expect(isValidLeadPublicationSnapshotData(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ estimatedJobValue: "900.00", price: "108.00", scopeQuestionnaireVersion: "test-scope-v1", scopeAnswers: { size: "large" } });
  });

  it("re-deriving later from the same stored scope and definition is byte-identical", async () => {
    const w = world();
    await w.submit.execute("u", input({ scopeAnswers: { size: "large" } }));
    expect(JSON.stringify(await w.price())).toBe(JSON.stringify(await w.price()));
  });

  it("a later definition version does not silently re-price the stored answers: the lead is left unpriced", async () => {
    const w = world();
    await w.submit.execute("u", input({ scopeAnswers: { size: "large" } }));
    expect(evaluateLeadPublicationPricing(await w.price(TEST_SCOPE_REGISTRY_V2)).ok).toBe(false);
  });

  it("no answers: no stored scope, no provenance, and the unscoped price (150.00 -> 18.00)", async () => {
    const w = world();
    await w.submit.execute("u", input());
    expect(w.stored.data).not.toHaveProperty("scope");
    const evaluation = evaluateLeadPublicationPricing(await w.price());
    expect(evaluation.ok && evaluation.pricing).toMatchObject({ estimatedJobValue: "150.00", price: "18.00" });
    expect(evaluation.ok && evaluation.pricing).not.toHaveProperty("scopeAnswers");
  });

  it("tampered storage between submission and publication fails closed", async () => {
    const w = world();
    await w.submit.execute("u", input({ scopeAnswers: { size: "small" } }));
    w.stored.data = { ...w.stored.data!, scope: { questionnaireVersion: "test-scope-v1", answers: { size: "enormous" } } };
    expect(evaluateLeadPublicationPricing(await w.price()).ok).toBe(false);
  });
});
