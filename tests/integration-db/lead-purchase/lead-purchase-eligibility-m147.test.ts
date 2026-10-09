/**
 * Module 147 — LEAD_V1 professional eligibility against REAL PostgreSQL.
 *
 * Nothing about eligibility is mocked: the policy reads the REAL M146 readiness use case over the real
 * billing-identity table (migration + guard triggers), M98 comes from the real professional_profiles
 * row, and purchase / payment initiation use the real Prisma repositories (lead row lock, partial
 * unique index, write-once payment reference). Proves what fakes cannot:
 *  - an ineligible professional creates NO lead_purchases row, whatever the billing state;
 *  - the decision follows the real billing lifecycle (save -> admin verify -> edit resets -> reject);
 *  - eligible purchase, pricing snapshot, duplicate protection, idempotent replay and concurrent
 *    initiation behave exactly as before;
 *  - payment initiation blocks a NEW provider payment for an ineligible professional but still reuses an
 *    already persisted attempt, and a CONFIRMED purchase is untouched.
 */
import { describe, expect, it, vi } from "vitest";

import { LeadPurchaseEligibilityPolicy } from "@/application/services/lead-purchase-eligibility-policy";
import { GetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/get-professional-billing-readiness.use-case";
import { VerifyBillingIdentityUseCase, RejectBillingIdentityUseCase } from "@/application/use-cases/billing-identity/review-billing-identity.use-cases";
import { InitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case";
import { InitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/initiate-lead-purchase.use-case";
import { GetMyLeadPurchaseEligibilityUseCase } from "@/application/use-cases/lead-purchase-eligibility/get-my-lead-purchase-eligibility.use-case";
import { ProfessionalNotVerifiedError } from "@/domain/errors/domain-error";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { LeadFeePaymentNotInitiableError } from "@/domain/services/lead-fee-payment";
import { DuplicateActiveLeadPurchaseError, LeadNotPurchasableError } from "@/domain/services/lead-purchase";
import { LeadPurchaseNotEligibleError } from "@/domain/services/lead-purchase-eligibility";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadPreviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-preview-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalBillingIdentityRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-billing-identity-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";

import { FakeLeadFeePaymentGateway } from "../../test-utils/fake-lead-fee-payment-gateway";
import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LAT = 40.4168;
const LNG = -3.7038;
const BILLING = {
  entityType: "COMPANY",
  legalName: "Fontanería Mediterránea S.L.",
  taxId: "B12345674",
  taxCountry: "ES",
  addressLine1: "Carrer Major 12",
  city: "Gandia",
  region: "Valencia",
  postalCode: "46700",
  country: "ES",
};

describe("Module 147 — lead purchase eligibility (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const professionals = new PrismaProfessionalRepository();
  const identities = new PrismaProfessionalBillingIdentityRepository();
  const policy = new LeadPurchaseEligibilityPolicy(new GetProfessionalBillingReadinessUseCase(identities));
  const verifyBilling = new VerifyBillingIdentityUseCase(identities);

  const discoveryFor = (categoryId: string): ProfessionalDiscoveryRepository =>
    ({ findCandidateById: async (id: string) => ({ id, categoryIds: [categoryId], latitude: LAT, longitude: LNG, serviceRadiusKm: 50 }) }) as unknown as ProfessionalDiscoveryRepository;
  const initiateFor = (categoryId: string) =>
    new InitiateLeadPurchaseUseCase(professionals, discoveryFor(categoryId), leads, new PrismaServiceRequestRepository(), new PrismaLeadPreviewRepository(), purchases, policy);

  let seq = 0;
  async function publishedLead(price = "100.00") {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Customer", email: `m147-customer-${seq}-${Date.now()}@example.invalid` });
    const address = await createAddress(prisma, customerUser.id);
    await prisma.address.update({ where: { id: address.id }, data: { latitude: LAT, longitude: LNG } });
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id, maxBuyers: null });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price, maxBuyers: 100 }))!;
    return { lead, category };
  }

  async function pro(over: { status?: "ACTIVE" | "INACTIVE" | "SUSPENDED"; verificationStatus?: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" } = {}) {
    const user = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, user.id);
    if (over.status || over.verificationStatus) await prisma.professionalProfile.update({ where: { id: profile.id }, data: over });
    return { user, profile };
  }

  /** Saves complete billing details and has an administrator verify exactly that revision. */
  async function verifiedBilling(profileId: string) {
    const admin = await createUser(prisma, { name: "Admin" });
    const { record } = await identities.saveDetails(profileId, assertValidBillingIdentityDetails(BILLING));
    await verifyBilling.execute(admin.id, { identityId: record.id, expectedRevision: record.revision });
    return { admin, identityId: record.id };
  }

  const count = () => prisma.leadPurchase.count();
  const fail = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  it("eligible: M98 VERIFIED + admin-verified complete billing -> the purchase is created exactly as before (snapshot price, tax, PENDING_PAYMENT)", async () => {
    const { lead, category } = await publishedLead("100.00");
    const { user, profile } = await pro();
    await verifiedBilling(profile.id);
    const dto = await initiateFor(category.id).execute(user.id, lead.id);
    expect(dto).toMatchObject({ leadId: lead.id, status: "PENDING_PAYMENT", price: 100, taxAmount: "21.00", totalAmount: "121.00", currency: "EUR" });
    expect(await count()).toBe(1);
  });

  it("no billing identity at all (every pre-M146 professional) -> BILLING_MISSING, and NO lead_purchases row exists", async () => {
    const { lead, category } = await publishedLead();
    const { user } = await pro();
    const error = await fail(initiateFor(category.id).execute(user.id, lead.id));
    expect(error).toBeInstanceOf(LeadPurchaseNotEligibleError);
    expect(error).toMatchObject({ reason: "BILLING_MISSING" });
    expect(await count()).toBe(0);
  });

  it("UNVERIFIED (awaiting review) and REJECTED billing fail closed; nothing is created", async () => {
    const { lead, category } = await publishedLead();
    const { user, profile } = await pro();
    const { record } = await identities.saveDetails(profile.id, assertValidBillingIdentityDetails(BILLING));
    expect(await fail(initiateFor(category.id).execute(user.id, lead.id))).toMatchObject({ reason: "BILLING_PENDING_REVIEW" });
    const admin = await createUser(prisma, { name: "Admin" });
    await new RejectBillingIdentityUseCase(identities).execute(admin.id, { identityId: record.id, expectedRevision: record.revision, reason: "TAX_ID_MISMATCH", note: null });
    expect(await fail(initiateFor(category.id).execute(user.id, lead.id))).toMatchObject({ reason: "BILLING_NEEDS_CORRECTION" });
    expect(await count()).toBe(0);
  });

  it("the decision follows the real lifecycle: verified -> eligible, a material edit invalidates it (trigger) -> ineligible again", async () => {
    const { lead, category } = await publishedLead();
    const { user, profile } = await pro();
    const view = new GetMyLeadPurchaseEligibilityUseCase(professionals, policy);
    await verifiedBilling(profile.id);
    expect(await view.execute(user.id)).toEqual({ eligible: true, reason: null });

    await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, legalName: "Otro Nombre S.L." }));
    expect(await view.execute(user.id)).toEqual({ eligible: false, reason: "BILLING_PENDING_REVIEW" });
    expect(await fail(initiateFor(category.id).execute(user.id, lead.id))).toBeInstanceOf(LeadPurchaseNotEligibleError);
    expect(await count()).toBe(0);
  });

  it.each([
    ["UNVERIFIED", { verificationStatus: "UNVERIFIED" as const }, ProfessionalNotVerifiedError],
    ["PENDING", { verificationStatus: "PENDING" as const }, ProfessionalNotVerifiedError],
    ["REJECTED", { verificationStatus: "REJECTED" as const }, ProfessionalNotVerifiedError],
    ["SUSPENDED", { status: "SUSPENDED" as const }, LeadNotPurchasableError],
    ["INACTIVE", { status: "INACTIVE" as const }, LeadNotPurchasableError],
  ])("M98 %s with perfectly verified billing is still refused with the pre-M147 error; billing never substitutes for M98", async (_name, over, errorClass) => {
    const { lead, category } = await publishedLead();
    const { user, profile } = await pro(over);
    await verifiedBilling(profile.id);
    expect(await fail(initiateFor(category.id).execute(user.id, lead.id))).toBeInstanceOf(errorClass);
    expect(await count()).toBe(0);
  });

  it("a populated profile taxId/businessName is NOT billing readiness nor M98 verification", async () => {
    const { lead, category } = await publishedLead();
    const { user, profile } = await pro({ verificationStatus: "UNVERIFIED" });
    await prisma.professionalProfile.update({ where: { id: profile.id }, data: { taxId: "B87654321", businessName: "Self Entered S.L." } });
    expect(await fail(initiateFor(category.id).execute(user.id, lead.id))).toBeInstanceOf(ProfessionalNotVerifiedError);
    await prisma.professionalProfile.update({ where: { id: profile.id }, data: { verificationStatus: "VERIFIED" } });
    expect(await fail(initiateFor(category.id).execute(user.id, lead.id))).toMatchObject({ reason: "BILLING_MISSING" });
    expect(await count()).toBe(0);
  });

  it("customer accounts / users with no professional profile cannot use the flow (generic, no existence probing)", async () => {
    const { lead, category } = await publishedLead();
    const customerOnly = await createUser(prisma, { name: "Just a customer" });
    expect(await fail(initiateFor(category.id).execute(customerOnly.id, lead.id))).toBeInstanceOf(LeadNotPurchasableError);
    expect(await count()).toBe(0);
  });

  it("a professional cannot borrow ANOTHER professional's verified billing: readiness is keyed by the session user's own profile", async () => {
    const { lead, category } = await publishedLead();
    const owner = await pro();
    await verifiedBilling(owner.profile.id);
    const other = await pro();
    expect(await fail(initiateFor(category.id).execute(other.user.id, lead.id))).toMatchObject({ reason: "BILLING_MISSING" });
    expect(await count()).toBe(0);
  });

  it("duplicate-purchase protection, idempotent replay and concurrent initiation are unchanged for an eligible professional", async () => {
    const { lead, category } = await publishedLead();
    const { user, profile } = await pro();
    await verifiedBilling(profile.id);
    const useCase = initiateFor(category.id);
    const results = await Promise.all([useCase.execute(user.id, lead.id), useCase.execute(user.id, lead.id), useCase.execute(user.id, lead.id)]);
    expect(new Set(results.map((r) => r.purchaseId)).size).toBe(1);
    expect(await count()).toBe(1);
    await prisma.leadPurchase.update({ where: { id: results[0]!.purchaseId }, data: { status: "CONFIRMED" } });
    expect(await fail(useCase.execute(user.id, lead.id))).toBeInstanceOf(DuplicateActiveLeadPurchaseError);
    expect(await count()).toBe(1);
  });

  it("concurrent initiation by an ineligible professional never creates a row", async () => {
    const { lead, category } = await publishedLead();
    const { user } = await pro();
    const useCase = initiateFor(category.id);
    const errors = await Promise.all([1, 2, 3, 4, 5].map(() => fail(useCase.execute(user.id, lead.id))));
    for (const e of errors) expect(e).toBeInstanceOf(LeadPurchaseNotEligibleError);
    expect(await count()).toBe(0);
  });

  describe("payment initiation (defensive re-check, new provider payments only)", () => {
    const build = () => {
      const gateway = new FakeLeadFeePaymentGateway();
      return { gateway, useCase: new InitiateLeadFeePaymentUseCase(professionals, purchases, leads, gateway, policy) };
    };

    it("eligible: creates the provider payment for the persisted total, unchanged", async () => {
      const { lead } = await publishedLead("100.00");
      const { user, profile } = await pro();
      await verifiedBilling(profile.id);
      const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
      const { gateway, useCase } = build();
      expect(await useCase.execute(user.id, purchase.id)).toMatchObject({ totalAmount: "121.00", purchaseStatus: "PENDING_PAYMENT" });
      expect(gateway.created).toHaveLength(1);
    });

    it("billing invalidated before the first payment attempt -> generic denial, no provider call, no reference", async () => {
      const { lead } = await publishedLead();
      const { user, profile } = await pro();
      await verifiedBilling(profile.id);
      const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
      await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, city: "Valencia" }));
      const { gateway, useCase } = build();
      const error = await fail(useCase.execute(user.id, purchase.id));
      expect(error).toBeInstanceOf(LeadFeePaymentNotInitiableError);
      expect(error).toMatchObject({ reason: "NOT_ELIGIBLE" });
      expect(gateway.created).toHaveLength(0);
      const row = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
      expect(row.paymentReference).toBeNull();
      expect(row.status).toBe("PENDING_PAYMENT");
    });

    it("legitimate retry: an already persisted attempt is reused after billing was invalidated (same client secret, no new provider payment)", async () => {
      const { lead } = await publishedLead();
      const { user, profile } = await pro();
      await verifiedBilling(profile.id);
      const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
      const { gateway, useCase } = build();
      const first = await useCase.execute(user.id, purchase.id);
      await identities.saveDetails(profile.id, assertValidBillingIdentityDetails({ ...BILLING, city: "Valencia" }));
      const retry = await useCase.execute(user.id, purchase.id);
      expect(retry.clientSecret).toBe(first.clientSecret);
      expect(gateway.created).toHaveLength(1);
    });

    it("a CONFIRMED purchase is still rejected as before (STATUS), never re-paid, whatever the billing state", async () => {
      const { lead } = await publishedLead();
      const { user, profile } = await pro();
      await verifiedBilling(profile.id);
      const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
      await prisma.leadPurchase.update({ where: { id: purchase.id }, data: { status: "CONFIRMED" } });
      const { gateway, useCase } = build();
      expect(await fail(useCase.execute(user.id, purchase.id))).toMatchObject({ reason: "STATUS" });
      expect(gateway.created).toHaveLength(0);
    });
  });
});
