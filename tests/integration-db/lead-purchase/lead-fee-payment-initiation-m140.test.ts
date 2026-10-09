/**
 * Module 140 — LEAD_V1 lead-fee payment initiation against REAL PostgreSQL with the
 * deterministic fake gateway (no Stripe, no network, no credentials).
 *
 * Proves what mocks cannot: the provider receives the persisted total in exact minor units,
 * the reference is persisted write-once/unique by the real migration, the purchase stays
 * PENDING_PAYMENT with an unchanged snapshot, concurrent initiations converge, a purchase
 * that turns terminal during the provider call never keeps a payment, and nothing leaks.
 */
import { describe, expect, it } from "vitest";

import { InitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/initiate-lead-fee-payment.use-case";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { LeadFeePaymentNotInitiableError } from "@/domain/services/lead-fee-payment";

import { FakeLeadFeePaymentGateway } from "../../test-utils/fake-lead-fee-payment-gateway";
import { M139_SECRET_ADDRESS, M139_SECRET_NAME, M139_SECRET_POSTAL_CODE, assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";
import { eligibilityPolicy } from "../../test-utils/lead-purchase-eligibility-fixtures";
import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import {
  createAddress,
  createCustomerProfile,
  createProfessionalProfile,
  createServiceCategory,
  createServiceRequest,
  createUser,
} from "../../test-utils/db/seed-helpers";

describe("Module 140 — lead-fee payment initiation (real PostgreSQL, fake gateway)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();

  // Per-file deterministic counter: email and phone are unique columns, so every customer gets its own
  // sentinel-style values (name / address / postal code are not unique and keep the exact M139 sentinels).
  let customerSeq = 0;
  const customerContacts: string[] = [];

  async function publishedLead(price = "100.00") {
    customerSeq += 1;
    const customerEmail = `m140-customer-${customerSeq}@example.invalid`;
    const customerPhone = `+3461400${String(customerSeq).padStart(4, "0")}`;
    customerContacts.push(customerEmail, customerPhone);
    const customerUser = await createUser(prisma, { name: M139_SECRET_NAME, email: customerEmail });
    await prisma.user.update({ where: { id: customerUser.id }, data: { phone: customerPhone } });
    const address = await createAddress(prisma, customerUser.id);
    await prisma.address.update({ where: { id: address.id }, data: { line1: M139_SECRET_ADDRESS, postalCode: M139_SECRET_POSTAL_CODE } });
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    return (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price, maxBuyers: 5 }))!;
  }

  async function professional() {
    const user = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, user.id);
    return { user, profile };
  }

  async function pendingPurchase(price = "100.00") {
    const lead = await publishedLead(price);
    const pro = await professional();
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: pro.profile.id });
    return { lead, pro, purchase };
  }

  function build(gateway = new FakeLeadFeePaymentGateway()) {
    return { gateway, useCase: new InitiateLeadFeePaymentUseCase(new PrismaProfessionalRepository(), purchases, leads, gateway, eligibilityPolicy()) };
  }

  const rejected = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
  const row = (id: string) => prisma.leadPurchase.findUniqueOrThrow({ where: { id } });

  it("sends the provider exactly 12100 minor units for a 100.00 + 21.00 purchase, persists the reference, stays PENDING_PAYMENT with an unchanged snapshot", async () => {
    const { pro, purchase } = await pendingPurchase("100.00");
    const before = await row(purchase.id);
    const { gateway, useCase } = build();

    const result = await useCase.execute(pro.user.id, purchase.id);

    expect(gateway.created).toHaveLength(1);
    expect(gateway.created[0]).toMatchObject({ amountMinorUnits: 12100, currency: "EUR", leadPurchaseId: purchase.id, idempotencyKey: `lead-fee-payment-intent:${purchase.id}` });
    expect(result).toMatchObject({ purchaseId: purchase.id, purchaseStatus: "PENDING_PAYMENT", totalAmount: "121.00", currency: "EUR" });

    const after = await row(purchase.id);
    expect(after.paymentReference).toBe("pi_fake_1");
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.confirmedAt).toBeNull();
    for (const column of ["price", "currency", "taxAmount", "totalAmount", "taxPolicyVersion", "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt"] as const) {
      expect(String(after[column])).toBe(String(before[column]));
    }
  });

  it("does not follow current pricing: a stored 18.05 purchase is paid as 2184 cents", async () => {
    const { pro, purchase } = await pendingPurchase("18.05");
    const { gateway, useCase } = build();
    await useCase.execute(pro.user.id, purchase.id);
    expect(gateway.created[0]?.amountMinorUnits).toBe(2184);
  });

  it("the response carries no customer / contact data (M139 sentinels)", async () => {
    const { pro, purchase } = await pendingPurchase();
    const result = await build().useCase.execute(pro.user.id, purchase.id);
    expect(() => assertNoContactLeak(JSON.parse(JSON.stringify(result)), customerContacts)).not.toThrow();
  });

  it("repeated and concurrent initiations converge on one provider payment and one persisted reference", async () => {
    const { pro, purchase } = await pendingPurchase();
    const { gateway, useCase } = build();
    const results = await Promise.all([useCase.execute(pro.user.id, purchase.id), useCase.execute(pro.user.id, purchase.id), useCase.execute(pro.user.id, purchase.id)]);
    const again = await useCase.execute(pro.user.id, purchase.id);
    expect(new Set([...results, again].map((r) => r.clientSecret)).size).toBe(1);
    expect(new Set(gateway.created.map((c) => c.idempotencyKey)).size).toBe(1);
    expect((await row(purchase.id)).paymentReference).toBe("pi_fake_1");
    expect(gateway.canceled).toEqual([]);
  });

  it("another professional cannot initiate payment for the purchase; nothing is created or persisted", async () => {
    const { purchase } = await pendingPurchase();
    const intruder = await professional();
    const { gateway, useCase } = build();
    expect(await rejected(useCase.execute(intruder.user.id, purchase.id))).toBeInstanceOf(LeadFeePaymentNotInitiableError);
    expect(gateway.created).toHaveLength(0);
    expect((await row(purchase.id)).paymentReference).toBeNull();
  });

  it.each(["CONFIRMED", "FAILED", "CANCELLED"] as const)("a %s purchase is rejected", async (status) => {
    const { pro, purchase } = await pendingPurchase();
    await prisma.leadPurchase.update({ where: { id: purchase.id }, data: { status } });
    const { gateway, useCase } = build();
    expect(await rejected(useCase.execute(pro.user.id, purchase.id))).toMatchObject({ reason: "STATUS" });
    expect(gateway.created).toHaveLength(0);
  });

  it("a purchase created before M135/M136 (no snapshot) is rejected as legacy", async () => {
    const lead = await publishedLead();
    const pro = await professional();
    const legacy = await purchases.create({ leadId: lead.id, professionalProfileId: pro.profile.id, price: 18 });
    const { gateway, useCase } = build();
    expect(await rejected(useCase.execute(pro.user.id, legacy.id))).toMatchObject({ reason: "LEGACY" });
    expect(gateway.created).toHaveLength(0);
  });

  it("provider failure leaves the purchase PENDING_PAYMENT, snapshot intact and no reference", async () => {
    const { pro, purchase } = await pendingPurchase();
    const gateway = new FakeLeadFeePaymentGateway();
    gateway.failCreate = new Error("provider down");
    const before = await row(purchase.id);
    expect(await rejected(build(gateway).useCase.execute(pro.user.id, purchase.id))).toMatchObject({ code: "LEAD_FEE_PAYMENT_UNAVAILABLE" });
    const after = await row(purchase.id);
    expect(after.paymentReference).toBeNull();
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(String(after.totalAmount)).toBe(String(before.totalAmount));
  });

  it("a purchase that turns terminal during the provider call keeps no reference and its new attempt is cancelled", async () => {
    const { pro, purchase } = await pendingPurchase();
    const gateway = new FakeLeadFeePaymentGateway();
    gateway.afterCreate = async () => {
      await purchases.transition(purchase.id, "PENDING_PAYMENT", "CANCELLED", new Date());
    };
    expect(await rejected(build(gateway).useCase.execute(pro.user.id, purchase.id))).toMatchObject({ reason: "STATUS" });
    expect(gateway.canceled).toEqual(["pi_fake_1"]);
    const after = await row(purchase.id);
    expect(after.paymentReference).toBeNull();
    expect(after.status).toBe("CANCELLED");
  });

  describe("database guarantees of paymentReference", () => {
    it("is write-once: a set reference can never change or be cleared; recordPaymentReference is conditional", async () => {
      const { purchase } = await pendingPurchase();
      expect((await purchases.recordPaymentReference(purchase.id, "pi_a"))?.paymentReference).toBe("pi_a");
      expect(await purchases.recordPaymentReference(purchase.id, "pi_b")).toBeNull();
      await expect(prisma.$executeRawUnsafe(`UPDATE lead_purchases SET "paymentReference" = 'pi_b' WHERE id = '${purchase.id}'`)).rejects.toThrow(/immutable/i);
      await expect(prisma.$executeRawUnsafe(`UPDATE lead_purchases SET "paymentReference" = NULL WHERE id = '${purchase.id}'`)).rejects.toThrow(/immutable/i);
      expect((await row(purchase.id)).paymentReference).toBe("pi_a");
    });

    it("is unique across purchases (one provider payment belongs to one purchase)", async () => {
      const a = await pendingPurchase();
      const b = await pendingPurchase();
      await purchases.recordPaymentReference(a.purchase.id, "pi_shared");
      await expect(purchases.recordPaymentReference(b.purchase.id, "pi_shared")).rejects.toThrow();
    });

    it("is only recorded for a PENDING_PAYMENT purchase, and the M135/M136 financial immutability still holds", async () => {
      const { purchase } = await pendingPurchase();
      await purchases.transition(purchase.id, "PENDING_PAYMENT", "CANCELLED", new Date());
      expect(await purchases.recordPaymentReference(purchase.id, "pi_late")).toBeNull();
      await expect(prisma.$executeRawUnsafe(`UPDATE lead_purchases SET "totalAmount" = 1 WHERE id = '${purchase.id}'`)).rejects.toThrow(/immutable|check/i);
    });
  });
});
