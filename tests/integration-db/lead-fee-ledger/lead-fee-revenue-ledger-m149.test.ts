/**
 * Module 149 — Lead-Fee Revenue Ledger against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the atomic confirm+entry transaction (and its rollback), the DB unique indexes
 * under genuinely concurrent deliveries, the CHECK constraints, the append-only trigger, and that the
 * migration's DDL is accepted by PostgreSQL. Run with `npm run test:integration:db`.
 */
import { describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadFeeRevenueLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";

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

describe("Module 149 — lead-fee revenue ledger (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const ledger = new PrismaLeadFeeRevenueLedgerRepository();
  const useCase = () =>
    new ProcessLeadFeePaymentWebhookUseCase(
      purchases,
      leads,
      new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
      new TransitionLeadPurchaseUseCase(purchases),
      new PrismaExternalWebhookEventRepository(),
      undefined,
      ledger,
    );

  let seq = 0;
  let evt = 0;

  async function pendingPurchase(price = "100.00") {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: `m149-customer-${seq}@test.maestroya.invalid` });
    const address = await createAddress(prisma, customerUser.id);
    const customer = await createCustomerProfile(prisma, customerUser.id);
    const category = await createServiceCategory(prisma);
    const request = await createServiceRequest(prisma, { customerId: customer.id, categoryId: category.id, addressId: address.id });
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { flowVersion: "LEAD_V1" } });
    const draft = await leads.create({ serviceRequestId: request.id });
    const lead = (await leads.publish(draft.id, { ...SNAPSHOT_DATA, price, maxBuyers: 5 }))!;
    const proUser = await createUser(prisma, { name: "Pro" });
    const profile = await createProfessionalProfile(prisma, proUser.id);
    const purchase = await purchases.initiate({ leadId: lead.id, professionalProfileId: profile.id });
    const reference = `pi_m149_${seq}`;
    await purchases.recordPaymentReference(purchase.id, reference);
    return { lead, purchase, reference, profile };
  }

  function event(reference: string, amountMinorUnits = 12100, type = "payment_intent.succeeded", id?: string): StripePaymentWebhookEvent {
    return {
      id: id ?? `evt_m149_${++evt}`,
      type,
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
  }

  const entries = (purchaseId: string) => prisma.leadFeeLedgerEntry.findMany({ where: { leadPurchaseId: purchaseId } });

  it("confirmation writes exactly one entry with persisted amount, currency, references and timestamps", async () => {
    const { lead, purchase, reference, profile } = await pendingPurchase();
    const e = event(reference, 12100, "payment_intent.succeeded", "evt_m149_src");
    expect((await useCase().execute(e)).outcome).toBe("confirmed");

    const rows = await entries(purchase.id);
    expect(rows).toHaveLength(1);
    const confirmed = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(rows[0]).toMatchObject({
      entryType: "LEAD_FEE_PAYMENT_SUCCEEDED",
      leadId: lead.id,
      professionalProfileId: profile.id,
      paymentReference: reference,
      providerEventId: "evt_m149_src",
      currency: "EUR",
    });
    expect(String(rows[0]!.netFeeAmount)).toBe("100");
    expect(String(rows[0]!.taxAmount)).toBe("21");
    expect(String(rows[0]!.totalCollectedAmount)).toBe("121");
    expect(rows[0]!.paymentConfirmedAt.getTime()).toBe(confirmed.confirmedAt!.getTime());
  });

  it("concurrent deliveries with distinct event ids and the same event id leave exactly one entry", async () => {
    const { purchase, reference } = await pendingPurchase();
    const same = event(reference);
    await Promise.all([...Array.from({ length: 5 }, () => useCase().execute(event(reference))), useCase().execute(same), useCase().execute(same)]);
    expect(await entries(purchase.id)).toHaveLength(1);
    expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } })).status).toBe("CONFIRMED");
  });

  it("reprocessing an already-confirmed payment never duplicates the entry", async () => {
    const { purchase, reference } = await pendingPurchase();
    await useCase().execute(event(reference));
    expect((await useCase().execute(event(reference))).outcome).toBe("already-confirmed");
    expect(await entries(purchase.id)).toHaveLength(1);
  });

  it("a purchase confirmed BEFORE M149 (no entry) is repaired once by a verified redelivery, keeping its original confirmation time", async () => {
    const { purchase, reference } = await pendingPurchase();
    const legacyConfirmed = (await purchases.transition(purchase.id, "PENDING_PAYMENT", "CONFIRMED", new Date("2026-10-01T00:00:00Z")))!;
    expect(await entries(purchase.id)).toHaveLength(0);

    expect((await useCase().execute(event(reference))).outcome).toBe("already-confirmed");
    expect((await useCase().execute(event(reference))).outcome).toBe("already-confirmed");
    const rows = await entries(purchase.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paymentConfirmedAt.getTime()).toBe(legacyConfirmed.confirmedAt!.getTime());
  });

  it("pending, failed, cancelled and rejected payments never create an entry", async () => {
    const pending = await pendingPurchase();
    const failed = await pendingPurchase();
    const canceled = await pendingPurchase();
    const wrongAmount = await pendingPurchase();
    await useCase().execute(event(failed.reference, 12100, "payment_intent.payment_failed"));
    await useCase().execute(event(canceled.reference, 12100, "payment_intent.canceled"));
    await useCase().execute(event(wrongAmount.reference, 100));
    expect(await prisma.leadFeeLedgerEntry.count()).toBe(0);
    expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: pending.purchase.id } })).status).toBe("PENDING_PAYMENT");
  });

  it("a ledger failure rolls the confirmation back: the purchase stays PENDING_PAYMENT and the error surfaces", async () => {
    const { purchase, reference } = await pendingPurchase();
    // Force the in-transaction insert to violate the (purchase, type) unique index.
    await prisma.leadFeeLedgerEntry.create({
      data: {
        entryType: "LEAD_FEE_PAYMENT_SUCCEEDED", leadPurchaseId: purchase.id, leadId: purchase.leadId, professionalProfileId: purchase.professionalProfileId,
        paymentReference: "pi_preexisting", providerEventId: "evt_pre", netFeeAmount: "1.00", taxAmount: "0.21", totalCollectedAmount: "1.21",
        currency: "EUR", taxPolicyVersion: "x", paymentConfirmedAt: new Date(),
      },
    });
    await expect(useCase().execute(event(reference))).rejects.toThrow();
    const after = await prisma.leadPurchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.confirmedAt).toBeNull();
  });

  it("DB guarantees: unique per purchase and per payment reference, amount CHECK, append-only", async () => {
    const { purchase, reference } = await pendingPurchase();
    await useCase().execute(event(reference));
    const [row] = await entries(purchase.id);
    const copy = { ...row!, id: undefined as unknown as string };
    delete (copy as Partial<typeof copy>).id;
    delete (copy as Partial<typeof copy>).recordedAt;

    await expect(prisma.leadFeeLedgerEntry.create({ data: copy })).rejects.toThrow(); // (purchase, type)
    const other = await pendingPurchase();
    await expect(
      prisma.leadFeeLedgerEntry.create({ data: { ...copy, leadPurchaseId: other.purchase.id, leadId: other.purchase.leadId, professionalProfileId: other.purchase.professionalProfileId } }),
    ).rejects.toThrow(); // (paymentReference, type)
    await expect(
      prisma.leadFeeLedgerEntry.create({ data: { ...copy, leadPurchaseId: other.purchase.id, paymentReference: "pi_other", totalCollectedAmount: "999.00" } }),
    ).rejects.toThrow(); // total != net + tax

    await expect(prisma.leadFeeLedgerEntry.update({ where: { id: row!.id }, data: { totalCollectedAmount: "1.00" } })).rejects.toThrow(/append-only/);
    await expect(prisma.leadFeeLedgerEntry.delete({ where: { id: row!.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.leadPurchase.delete({ where: { id: purchase.id } })).rejects.toThrow(); // FK RESTRICT
    expect(await entries(purchase.id)).toHaveLength(1);
  });

  it("legacy payment / payout / transaction tables are untouched by a lead-fee confirmation", async () => {
    const { reference } = await pendingPurchase();
    await useCase().execute(event(reference));
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.payout.count()).toBe(0);
    expect(await prisma.commission.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });
});
