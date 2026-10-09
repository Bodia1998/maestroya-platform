import { describe, expect, it, vi } from "vitest";

import { eligibilityPolicy } from "../../../../../test-utils/lead-purchase-eligibility-fixtures";
import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import { ConfiguredLeadPurchasePriceProvider } from "@/application/services/lead-pricing/configured-lead-purchase-price-provider";
import { EstimatedValueLeadPricingContextReader } from "@/application/services/lead-pricing/estimated-value-lead-pricing-context-reader";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import type { InitiateLeadPurchaseData, LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import type { JobValueEstimationConfig, JobValueEstimationContext } from "@/domain/services/job-value-estimation";
import { LeadPricingUnavailableError } from "@/domain/services/lead-pricing";
import { JOB_VALUE_ESTIMATION_CONFIG_V1 } from "@/infrastructure/pricing/job-value-estimation-config.v1";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";
import { pendingPurchaseFromPublication } from "../../../../../test-utils/lead-purchase-fixtures";

/** A legitimately published (M133) LEAD_V1 lead: complete immutable snapshot, so purchase initiation passes the marketplace-readiness check and actually reaches pricing. */
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-06T10:00:00Z") };
const USER = "pro-user";
const LEAD = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";

const ctx = (patch: Partial<JobValueEstimationContext> = {}): JobValueEstimationContext => ({
  flowVersion: "LEAD_V1",
  categorySlug: "fontaneria",
  parentCategorySlug: null,
  urgency: "HIGH",
  ...patch,
});

// A test config with a job-type (subcategory) entry so a MEDIUM estimate is reachable.
const estimationConfig: JobValueEstimationConfig = {
  ...JOB_VALUE_ESTIMATION_CONFIG_V1,
  ruleVersion: "test-v1",
  baseValueBySlug: { ...JOB_VALUE_ESTIMATION_CONFIG_V1.baseValueBySlug, fontanero: "150.00" },
};

class FakePurchases implements LeadPurchaseRepository {
  rows: LeadPurchaseRecord[] = [];
  async create(): Promise<LeadPurchaseRecord> {
    throw new Error("unused");
  }
  async initiate(d: InitiateLeadPurchaseData): Promise<LeadPurchaseRecord> {
    const row = pendingPurchaseFromPublication(`p-${this.rows.length + 1}`, d.leadId, d.professionalProfileId, PUBLICATION);
    this.rows.push(row);
    return { ...row };
  }
  async transition(): Promise<LeadPurchaseRecord | null> {
    return null;
  }
  async findById() {
    return null;
  }
  async findActiveByLeadAndProfessional() {
    return null;
  }
  async recordPaymentReference() {
    return null;
  }
  async findConfirmedByLeadAndProfessional() {
    return null;
  }
}

function build(context: JobValueEstimationContext | null, config: JobValueEstimationConfig = estimationConfig) {
  const estimationReader: JobValueEstimationContextReader = { findByLeadId: vi.fn(async () => context) };
  const pricingContexts = new EstimatedValueLeadPricingContextReader(estimationReader, config);
  const provider = new ConfiguredLeadPurchasePriceProvider(pricingContexts, LEAD_PRICING_CONFIG_V1);
  const purchases = new FakePurchases();
  const preview = { leadId: LEAD, title: "Fuga", description: "d", categoryId: "cat-1", categoryName: "Fontanería", urgency: "HIGH", city: "Madrid", province: "Madrid", latitude: 40.4, longitude: -3.7, customerUserId: "customer-secret", createdAt: new Date() };
  const useCase = new InitiateLeadPurchaseUseCase(
    { findByUserId: async () => ({ id: "pro-1", status: "ACTIVE", verificationStatus: "VERIFIED" }) } as never,
    { findCandidateById: async () => ({ id: "pro-1", categoryIds: ["cat-1"], latitude: 40.4, longitude: -3.7, serviceRadiusKm: 50 }) } as never,
    { findById: async () => ({ id: LEAD, serviceRequestId: REQUEST, status: "PUBLISHED", flowVersion: "LEAD_V1", maxBuyers: SNAPSHOT_DATA.maxBuyers, publication: PUBLICATION }) } as never,
    { findById: async () => ({ id: REQUEST, status: "PUBLISHED", title: "Fuga", description: "d", location: { city: "Madrid" } }) } as never,
    { findPublishedById: async () => preview, findPublishedByCategoryIds: vi.fn() } as never,
    purchases,
    eligibilityPolicy(),
  );
  return { estimationReader, pricingContexts, provider, purchases, useCase };
}

describe("EstimatedValueLeadPricingContextReader (adapter only)", () => {
  it("maps an ESTIMATED result into the pricing context, confidence passed through", async () => {
    const { pricingContexts } = build(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }));
    await expect(pricingContexts.findByLeadId(LEAD)).resolves.toEqual({
      flowVersion: "LEAD_V1",
      categorySlug: "fontanero",
      parentCategorySlug: "fontaneria",
      urgency: "HIGH",
      estimatedServiceValue: { amount: "150.00", currency: "EUR", confidence: "MEDIUM" },
    });
  });

  it.each([
    ["unsupported category", ctx({ categorySlug: "limpieza" })],
    ["large-project category", ctx({ categorySlug: "reformas" })],
    ["legacy flow", ctx({ flowVersion: "LEGACY_QUOTE_PAYMENT" })],
    ["missing category", ctx({ categorySlug: null })],
  ])("%s -> estimatedServiceValue null", async (_n, c) => {
    const r = await build(c).pricingContexts.findByLeadId(LEAD);
    expect(r?.estimatedServiceValue).toBeNull();
  });

  it("unknown lead -> null", async () => {
    await expect(build(null).pricingContexts.findByLeadId(LEAD)).resolves.toBeNull();
  });
});

describe("Job Value Estimation -> Lead Pricing Engine (publication-time pricing) and LeadPurchase (snapshot only, M135)", () => {
  it("MEDIUM estimate is priced by M128 (150 x 0.12 = 18.00)", async () => {
    const b = build(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }));
    await expect(b.provider.getPriceForLead(LEAD)).resolves.toEqual({ price: 18, currency: "EUR" });
  });

  it("purchase initiation never consults the estimator/pricing engine: the fee is the lead's publication snapshot", async () => {
    const b = build(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }));
    const dto = await b.useCase.execute(USER, LEAD);
    expect(dto).toMatchObject({ status: "PENDING_PAYMENT", price: Number(SNAPSHOT_DATA.price), currency: "EUR" });
    expect(b.estimationReader.findByLeadId).not.toHaveBeenCalled();
    expect(b.purchases.rows).toHaveLength(1);
  });

  it("a LOW estimate (category-level only) is UNPRICED by M128's minimum confidence", async () => {
    const b = build(ctx(), JOB_VALUE_ESTIMATION_CONFIG_V1);
    await expect(b.provider.getPriceForLead(LEAD)).rejects.toMatchObject({ code: "LEAD_PRICING_UNAVAILABLE", status: "UNPRICED", reason: "CONFIDENCE_TOO_LOW" });
  });

  it.each([
    ["unsupported category", ctx({ categorySlug: "limpieza" })],
    ["large-project category", ctx({ categorySlug: "reformas" })],
    ["legacy flow", ctx({ flowVersion: "LEGACY_QUOTE_PAYMENT" })],
    ["missing category", ctx({ categorySlug: null })],
    ["lead not found", null],
  ])("estimate unavailable (%s) -> UNPRICED (never zero/cheap)", async (_n, c) => {
    const b = build(c);
    await expect(b.provider.getPriceForLead(LEAD)).rejects.toBeInstanceOf(LeadPricingUnavailableError);
  });

  it("invalid estimation configuration fails closed", async () => {
    const b = build(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }), { ...estimationConfig, maximumValue: "nope" });
    await expect(b.provider.getPriceForLead(LEAD)).rejects.toMatchObject({ reason: "SERVICE_VALUE_UNAVAILABLE" });
  });

  it("a later estimation-config change does not mutate an existing purchase snapshot", async () => {
    const b = build(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }));
    await b.useCase.execute(USER, LEAD);
    const later = build(ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }), { ...estimationConfig, baseValueBySlug: { fontanero: "300.00" } });
    await expect(later.provider.getPriceForLead(LEAD)).resolves.toEqual({ price: 36, currency: "EUR" });
    expect(b.purchases.rows[0]?.price).toBe(Number(SNAPSHOT_DATA.price));
  });

  it("the customer budget cannot reach pricing: a smuggled budget does not change the result", async () => {
    const smuggled = { ...ctx({ categorySlug: "fontanero", parentCategorySlug: "fontaneria" }), budgetMax: "10.00" } as JobValueEstimationContext;
    await expect(build(smuggled).provider.getPriceForLead(LEAD)).resolves.toEqual({ price: 18, currency: "EUR" });
  });
});
