import { describe, expect, it, vi } from "vitest";

import type { LeadPricingContextReader } from "@/application/ports/lead-pricing-context-reader";
import { ConfiguredLeadPurchasePriceProvider } from "@/application/services/lead-pricing/configured-lead-purchase-price-provider";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import type { LeadPreviewCandidate } from "@/domain/repositories/lead-preview-repository";
import type { CreateLeadPurchaseData, LeadPurchaseRecord, LeadPurchaseRepository } from "@/domain/repositories/lead-purchase-repository";
import { LeadPurchasePricingError } from "@/domain/services/lead-purchase";
import { LeadPricingUnavailableError, type LeadPricingConfig, type LeadPricingContext } from "@/domain/services/lead-pricing";
import { LEAD_PRICING_CONFIG_V1 } from "@/infrastructure/pricing/lead-pricing-config.v1";
import { SNAPSHOT_DATA } from "../../../../../test-utils/lead-publication-fixtures";

/** A legitimately published (M133) LEAD_V1 lead: complete immutable snapshot, so purchase initiation passes the marketplace-readiness check and actually reaches pricing. */
const PUBLICATION = { ...SNAPSHOT_DATA, publishedAt: new Date("2026-10-06T10:00:00Z") };
const USER = "pro-user";
const LEAD = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";

const context = (patch: Partial<LeadPricingContext> = {}, amount: string | null = "600.00"): LeadPricingContext => ({
  flowVersion: "LEAD_V1",
  categorySlug: "fontaneria",
  parentCategorySlug: null,
  urgency: "HIGH",
  estimatedServiceValue: amount === null ? null : { amount, currency: "EUR", confidence: "HIGH" },
  ...patch,
});

class FakePurchases implements LeadPurchaseRepository {
  rows: LeadPurchaseRecord[] = [];
  async create(): Promise<LeadPurchaseRecord> {
    throw new Error("unused");
  }
  async initiate(d: CreateLeadPurchaseData): Promise<LeadPurchaseRecord> {
    const row: LeadPurchaseRecord = {
      id: `p-${this.rows.length + 1}`,
      leadId: d.leadId,
      professionalProfileId: d.professionalProfileId,
      status: "PENDING_PAYMENT",
      price: d.price,
      currency: d.currency ?? "EUR",
      confirmedAt: null,
      refundedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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
  async findConfirmedByLeadAndProfessional() {
    return null;
  }
}

function build(ctx: LeadPricingContext | null, config: LeadPricingConfig = LEAD_PRICING_CONFIG_V1) {
  const reader: LeadPricingContextReader = { findByLeadId: vi.fn(async () => ctx) };
  const provider = new ConfiguredLeadPurchasePriceProvider(reader, config);
  const purchases = new FakePurchases();
  const preview = {
    leadId: LEAD,
    title: "Fuga",
    description: "d",
    categoryId: "cat-1",
    categoryName: "Fontanería",
    urgency: "HIGH",
    city: "Madrid",
    province: "Madrid",
    latitude: 40.4,
    longitude: -3.7,
    customerUserId: "customer-secret",
    createdAt: new Date(),
  } satisfies LeadPreviewCandidate;
  const useCase = new InitiateLeadPurchaseUseCase(
    { findByUserId: async () => ({ id: "pro-1", status: "ACTIVE", verificationStatus: "VERIFIED" }) } as never,
    { findCandidateById: async () => ({ id: "pro-1", categoryIds: ["cat-1"], latitude: 40.4, longitude: -3.7, serviceRadiusKm: 50 }) } as never,
    { findById: async () => ({ id: LEAD, serviceRequestId: REQUEST, status: "PUBLISHED", flowVersion: "LEAD_V1", maxBuyers: SNAPSHOT_DATA.maxBuyers, publication: PUBLICATION }) } as never,
    { findById: async () => ({ id: REQUEST, status: "PUBLISHED", title: "Fuga", description: "d", location: { city: "Madrid" } }) } as never,
    { findPublishedById: async () => preview, findPublishedByCategoryIds: vi.fn() } as never,
    purchases,
    provider,
  );
  return { reader, provider, purchases, useCase };
}

describe("ConfiguredLeadPurchasePriceProvider", () => {
  it("returns the engine price as the existing LeadPurchasePrice shape", async () => {
    const { provider, reader } = build(context());
    await expect(provider.getPriceForLead(LEAD)).resolves.toEqual({ price: 72, currency: "EUR" });
    expect(reader.findByLeadId).toHaveBeenCalledWith(LEAD);
  });

  it("keeps cents exact at the number boundary", async () => {
    const { provider } = build(context({}, "1234.56"));
    await expect(provider.getPriceForLead(LEAD)).resolves.toEqual({ price: 148.15, currency: "EUR" });
  });

  it.each([
    ["lead not found", null, "LEAD_NOT_FOUND"],
    ["no job-value source", context({}, null), "SERVICE_VALUE_UNAVAILABLE"],
    ["legacy flow", context({ flowVersion: "LEGACY_QUOTE_PAYMENT" }), "NOT_LEAD_V1"],
    ["unknown category", context({ categorySlug: "limpieza" }), "RATE_NOT_CONFIGURED"],
    ["zero value", context({}, "0.00"), "INVALID_SERVICE_VALUE"],
  ])("%s -> LeadPricingUnavailableError (fail closed)", async (_n, ctx, reason) => {
    const { provider } = build(ctx);
    await expect(provider.getPriceForLead(LEAD)).rejects.toMatchObject({ code: "LEAD_PRICING_UNAVAILABLE", reason });
    await expect(provider.getPriceForLead(LEAD)).rejects.toBeInstanceOf(LeadPricingUnavailableError);
  });

  it("invalid configuration fails closed", async () => {
    const { provider } = build(context(), { ...LEAD_PRICING_CONFIG_V1, minimumPrice: "9.00", maximumPrice: "1.00" });
    await expect(provider.getPriceForLead(LEAD)).rejects.toMatchObject({ reason: "INVALID_CONFIGURATION" });
  });
});

describe("Lead pricing -> InitiateLeadPurchaseUseCase -> LeadPurchase.price", () => {
  it("snapshots the calculated price into the purchase", async () => {
    const b = build(context());
    const dto = await b.useCase.execute(USER, LEAD);
    expect(dto).toMatchObject({ status: "PENDING_PAYMENT", price: 72, currency: "EUR" });
    expect(b.purchases.rows).toHaveLength(1);
    expect(b.purchases.rows[0]).toMatchObject({ price: 72, currency: "EUR" });
  });

  it("the public DTO stays contact-safe and exposes no pricing internals", async () => {
    const dto = await build(context()).useCase.execute(USER, LEAD);
    expect(Object.keys(dto).sort()).toEqual(["confirmedAt", "createdAt", "currency", "leadId", "price", "purchaseId", "status"]);
    const json = JSON.stringify(dto);
    for (const leaked of ["ruleVersion", "lead-pricing", "rate", "factors", "uncapped", "customer-secret"]) expect(json).not.toContain(leaked);
  });

  it("a later configuration change does not mutate an existing purchase", async () => {
    const b = build(context());
    await b.useCase.execute(USER, LEAD);
    const later = build(context(), { ...LEAD_PRICING_CONFIG_V1, rateBySlug: { fontaneria: "0.15" } });
    await expect(later.provider.getPriceForLead(LEAD)).resolves.toMatchObject({ price: 90 });
    expect(b.purchases.rows).toHaveLength(1);
    expect(b.purchases.rows[0]?.price).toBe(72);
  });

  it("the cap applies end to end (large project)", async () => {
    const b = build(context({ categorySlug: "reformas" }, "50000.00"));
    expect((await b.useCase.execute(USER, LEAD)).price).toBe(150);
  });

  it.each([
    ["no job-value estimate", context({}, null)],
    ["legacy flow", context({ flowVersion: "LEGACY_QUOTE_PAYMENT" })],
    ["unknown category", context({ categorySlug: "limpieza" })],
    ["zero service value", context({}, "0.00")],
    ["lead missing for pricing", null],
  ])("pricing failure (%s) -> LeadPurchasePricingError and NO purchase (never zero/cheap)", async (_n, ctx) => {
    const b = build(ctx);
    const err = await b.useCase.execute(USER, LEAD).catch((e) => e);
    expect(err).toBeInstanceOf(LeadPurchasePricingError);
    expect(err.message).toBe("The price for this lead could not be determined. Please try again later.");
    expect(b.purchases.rows).toHaveLength(0);
  });
});
