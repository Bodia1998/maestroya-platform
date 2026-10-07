/**
 * Module 141 — LEAD_V1 lead-fee payment confirmation against REAL PostgreSQL.
 *
 * Proves what mocks cannot: correlation through the unique write-once `paymentReference`, the
 * status-conditional PENDING_PAYMENT -> CONFIRMED write under genuinely concurrent deliveries,
 * the immutable snapshot/reference staying untouched, no side records, and M138 contact access
 * following the status — with no contact data in the webhook result.
 */
import { describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { GetLeadContactUseCase } from "@/application/use-cases/lead-contact/get-lead-contact.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { LeadContactAccessDeniedError } from "@/domain/services/lead-contact-access-policy";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadContactAuthorizationReader, PrismaLeadContactReader } from "@/infrastructure/database/prisma/repositories/prisma-lead-contact-access-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";

import { assertNoContactLeak } from "../../test-utils/contact-leak-sentinels";
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

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("Module 141 — lead-fee payment confirmation (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const useCase = () =>
    new ProcessLeadFeePaymentWebhookUseCase(
      purchases,
      leads,
      new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
      new TransitionLeadPurchaseUseCase(purchases),
      new PrismaExternalWebhookEventRepository(),
    );
  const getContact = new GetLeadContactUseCase(
    new PrismaUserRepository(),
    new PrismaProfessionalRepository(),
    new PrismaLeadContactAuthorizationReader(),
    new PrismaLeadContactReader(),
  );

  let seq = 0;
  let evt = 0;

  async function pendingPurchase(price = "100.00", flow: "LEAD_V1" | "LEGACY_QUOTE_PAYMENT" = "LEAD_V1") {
    seq += 1;
    const email = `m141-customer-${seq}@test.maestroya.invalid`;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email });
    await prisma.user.update({ where: { id: customerUser.id }, data: { phone: `+3461410${String(seq).padStart(4, "0")}` } });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price, maxBuyers: 5 }))!;
    if (flow !== "LEAD_V1") await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: flow } });
    const proUser = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, proUser.id);
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
    const reference = `pi_m141_${seq}`;
    await purchases.recordPaymentReference(purchase.id, reference);
    return { lead, purchase, reference, proUser, customerEmail: email };
  }

  function event(reference: string, over: Partial<NonNullable<StripePaymentWebhookEvent["paymentIntent"]>> = {}, type = "payment_intent.succeeded"): StripePaymentWebhookEvent {
    return {
      id: `evt_m141_${++evt}`,
      type,
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits: 12100, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null, ...over },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
  }

  const row = (id: string) => prisma.leadPurchase.findUniqueOrThrow({ where: { id } });
  const money = ["price", "currency", "taxAmount", "totalAmount", "taxPolicyVersion", "pricingConfigVersion", "pricingRuleVersion", "leadPublishedAt"] as const;
  const sideRecordCounts = async () => ({
    payments: await prisma.payment.count(),
    commissions: await prisma.commission.count(),
    payouts: await prisma.payout.count(),
  });

  it("PENDING_PAYMENT -> CONFIRMED; snapshot and reference unchanged; no payment/commission/payout rows", async () => {
    const { purchase, reference } = await pendingPurchase();
    const before = await row(purchase.id);
    const sideBefore = await sideRecordCounts();

    const result = await useCase().execute(event(reference, { leadPurchaseId: purchase.id, leadId: purchase.leadId }));

    expect(result).toEqual({ outcome: "confirmed" });
    const after = await row(purchase.id);
    expect(after.status).toBe("CONFIRMED");
    expect(after.confirmedAt).toBeInstanceOf(Date);
    expect(after.paymentReference).toBe(reference);
    for (const c of money) expect(String(after[c])).toBe(String(before[c]));
    expect(await sideRecordCounts()).toEqual(sideBefore);
  });

  it("M138: contact is unavailable while PENDING_PAYMENT and available after the webhook confirms — never in the webhook result", async () => {
    const { lead, purchase, reference, proUser, customerEmail } = await pendingPurchase();
    await expect(getContact.execute(proUser.id, lead.id)).rejects.toBeInstanceOf(LeadContactAccessDeniedError);

    const result = await useCase().execute(event(reference));
    expect(() => assertNoContactLeak(result, [customerEmail])).not.toThrow();

    const contact = await getContact.execute(proUser.id, lead.id);
    expect(contact.email).toBe(customerEmail);
    expect(purchase.status).toBe("PENDING_PAYMENT");
  });

  it("concurrent identical success deliveries (distinct event ids) confirm exactly once", async () => {
    const { purchase, reference } = await pendingPurchase();
    const results = await Promise.all(Array.from({ length: 6 }, () => useCase().execute(event(reference))));
    const confirmed = await row(purchase.id);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(results.every((r) => r.outcome === "confirmed" || r.outcome === "already-confirmed")).toBe(true);
    // confirmedAt is stamped by exactly one transition: a later redelivery must not move it.
    await useCase().execute(event(reference));
    expect((await row(purchase.id)).confirmedAt?.getTime()).toBe(confirmed.confirmedAt?.getTime());
  });

  it("the very same event id delivered concurrently is processed once", async () => {
    const { reference } = await pendingPurchase();
    const e = event(reference);
    const results = await Promise.all([useCase().execute(e), useCase().execute(e), useCase().execute(e)]);
    expect(results.filter((r) => r.outcome === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate").length).toBeGreaterThanOrEqual(1);
  });

  it("already CONFIRMED + same PaymentIntent is idempotent; a different PaymentIntent matches nothing and overwrites nothing", async () => {
    const { purchase, reference } = await pendingPurchase();
    await useCase().execute(event(reference));
    expect((await useCase().execute(event(reference))).outcome).toBe("already-confirmed");
    expect((await useCase().execute(event("pi_somebody_else"))).outcome).toBe("unmatched");
    expect((await row(purchase.id)).paymentReference).toBe(reference);
  });

  it("orphan payment: unknown PaymentIntent creates nothing and confirms nothing", async () => {
    const { purchase } = await pendingPurchase();
    const purchasesBefore = await prisma.leadPurchase.count();
    expect((await useCase().execute(event("pi_ghost", { leadPurchaseId: purchase.id }))).outcome).toBe("unmatched");
    expect(await prisma.leadPurchase.count()).toBe(purchasesBefore);
    expect((await row(purchase.id)).status).toBe("PENDING_PAYMENT");
  });

  it("a payment whose metadata points at ANOTHER purchase is rejected and both purchases stay untouched", async () => {
    const a = await pendingPurchase();
    const b = await pendingPurchase();
    const result = await useCase().execute(event(a.reference, { leadPurchaseId: b.purchase.id }));
    expect(result).toMatchObject({ outcome: "rejected", rejection: "PURCHASE_METADATA_MISMATCH" });
    expect((await row(a.purchase.id)).status).toBe("PENDING_PAYMENT");
    expect((await row(b.purchase.id)).status).toBe("PENDING_PAYMENT");
  });

  it.each([
    ["amount mismatch", { amountMinorUnits: 12000 }],
    ["malformed amount", { amountMinorUnits: 121.0001 }],
    ["currency mismatch", { currency: "usd" }],
  ] as const)("%s is rejected and the purchase stays PENDING_PAYMENT", async (_n, over) => {
    const { purchase, reference } = await pendingPurchase();
    expect((await useCase().execute(event(reference, over))).outcome).toBe("rejected");
    expect((await row(purchase.id)).status).toBe("PENDING_PAYMENT");
  });

  it("a legacy-flow lead is never confirmed by this path", async () => {
    const { purchase, reference } = await pendingPurchase("100.00", "LEGACY_QUOTE_PAYMENT");
    expect((await useCase().execute(event(reference))).outcome).toBe("rejected");
    expect((await row(purchase.id)).status).toBe("PENDING_PAYMENT");
  });

  it("payment_failed leaves it PENDING_PAYMENT (and a retry can still succeed); canceled -> CANCELLED, never CONFIRMED", async () => {
    const failed = await pendingPurchase();
    expect((await useCase().execute(event(failed.reference, {}, "payment_intent.payment_failed"))).outcome).toBe("payment-failed-observed");
    expect((await row(failed.purchase.id)).status).toBe("PENDING_PAYMENT");
    expect((await useCase().execute(event(failed.reference))).outcome).toBe("confirmed");

    const canceled = await pendingPurchase();
    const before = await row(canceled.purchase.id);
    expect((await useCase().execute(event(canceled.reference, {}, "payment_intent.canceled"))).outcome).toBe("cancelled");
    const after = await row(canceled.purchase.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.confirmedAt).toBeNull();
    for (const c of money) expect(String(after[c])).toBe(String(before[c]));
    // A late success on a canceled purchase can never confirm it.
    expect((await useCase().execute(event(canceled.reference))).outcome).toBe("rejected");
    expect((await row(canceled.purchase.id)).status).toBe("CANCELLED");
  });

  it("the write-once reference cannot be replaced (DB-level), so a webhook can never repair/overwrite it", async () => {
    const { purchase, reference } = await pendingPurchase();
    expect(await purchases.recordPaymentReference(purchase.id, "pi_other")).toBeNull();
    await expect(prisma.leadPurchase.update({ where: { id: purchase.id }, data: { paymentReference: "pi_other" } })).rejects.toBeTruthy();
    expect((await row(purchase.id)).paymentReference).toBe(reference);
  });
});
