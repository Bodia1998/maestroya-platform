/**
 * Module 153 — Lead-Fee Refund Execution against REAL PostgreSQL.
 *
 * Proves what mocks cannot: the migration's DDL, the partial unique index (one active attempt per payment), the INSERT /
 * UPDATE / DELETE triggers and CHECKs, the real Prisma adapter, the real purchase transition, genuinely concurrent
 * execution, and that no ledger / invoice / credit-note row is touched. The provider is the in-memory fake (no network, no
 * real money). Run with `npm run test:integration:db` (requires the guarded test database — see tests/test-utils/db).
 */
import { describe, expect, it, vi } from "vitest";

import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import { ConfirmLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/confirm-lead-purchase.use-case";
import { ProcessLeadFeePaymentWebhookUseCase } from "@/application/use-cases/lead-fee-payment/process-lead-fee-payment-webhook.use-case";
import { ExecuteLeadFeeRefundUseCase } from "@/application/use-cases/lead-fee-refund/execute-lead-fee-refund.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { LeadFeeRefundRejectedError, resolveLeadFeeRefundConfig } from "@/domain/services/lead-fee-refund";
import { prisma } from "@/infrastructure/database/prisma/client";
import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaLeadFeeRefundRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-refund-repository";
import { PrismaLeadFeeRevenueLedgerRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { PrismaLeadRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";

import { FakeLeadFeePaymentGateway } from "../../test-utils/fake-lead-fee-payment-gateway";
import { SNAPSHOT_DATA } from "../../test-utils/lead-publication-fixtures";
import { setupDbTestLifecycle } from "../../test-utils/db/db-test-lifecycle";
import { createAddress, createCustomerProfile, createProfessionalProfile, createServiceCategory, createServiceRequest, createUser } from "../../test-utils/db/seed-helpers";

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("Module 153 — lead-fee refund (real PostgreSQL)", () => {
  setupDbTestLifecycle();

  const leads = new PrismaLeadRepository();
  const purchases = new PrismaLeadPurchaseRepository();
  const ledger = new PrismaLeadFeeRevenueLedgerRepository();
  const refunds = new PrismaLeadFeeRefundRepository();
  let seq = 0;
  let evt = 0;

  const webhook = () =>
    new ProcessLeadFeePaymentWebhookUseCase(
      purchases,
      leads,
      new ConfirmLeadPurchaseUseCase(purchases, leads, new PrismaServiceRequestRepository()),
      new TransitionLeadPurchaseUseCase(purchases),
      new PrismaExternalWebhookEventRepository(),
      undefined,
      ledger,
    );

  async function confirmedPurchase(price = "100.00", totalMinorUnits = 12100) {
    seq += 1;
    const customerUser = await createUser(prisma, { name: "Ana Cliente", email: `m153-customer-${seq}@test.maestroya.invalid` });
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
    const reference = `pi_m153_${seq}`;
    await purchases.recordPaymentReference(purchase.id, reference);
    const event: StripePaymentWebhookEvent = {
      id: `evt_m153_${++evt}`,
      type: "payment_intent.succeeded",
      createdAt: new Date(),
      paymentIntent: { paymentIntentId: reference, lastPaymentErrorMessage: null, amountMinorUnits: totalMinorUnits, currency: "eur", flow: "LEAD_V1", leadPurchaseId: null, leadId: null },
      chargeRefunded: null,
      dispute: null,
      chargeUpdated: null,
    };
    expect((await webhook().execute(event)).outcome).toBe("confirmed");
    const admin = await createUser(prisma, { name: "Admin" });
    return { purchaseId: purchase.id, reference, adminId: admin.id, totalMinorUnits };
  }

  function world(base: { purchaseId: string; reference: string; adminId: string; totalMinorUnits: number }, enabled = true) {
    const gateway = new FakeLeadFeePaymentGateway();
    gateway.plantPayment(base.reference, { leadPurchaseId: base.purchaseId, amountMinorUnits: base.totalMinorUnits });
    const useCase = new ExecuteLeadFeeRefundUseCase(
      purchases,
      refunds,
      gateway,
      { getUserById: async (id: string) => ({ id, name: null, email: null, phone: null, status: "ACTIVE" as const, roles: ["ADMIN"], hasProfessionalProfile: false, lastLoginAt: null, createdAt: new Date() }) },
      new TransitionLeadPurchaseUseCase(purchases),
      () => resolveLeadFeeRefundConfig(enabled ? { LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED: "true" } : {}),
    );
    const input = (patch: Record<string, unknown> = {}) => ({
      actorUserId: base.adminId,
      leadPurchaseId: base.purchaseId,
      reasonCode: "PLATFORM_ERROR" as const,
      explanation: "A MaestroYa defect made the paid lead unusable.",
      evidenceReference: "INC-9001",
      ...patch,
    });
    return { gateway, useCase, input };
  }

  const draft = (base: { purchaseId: string; reference: string; adminId: string }, patch: Record<string, unknown> = {}) => ({
    leadPurchaseId: base.purchaseId,
    reasonCode: "PLATFORM_ERROR" as const,
    attemptNumber: 1,
    status: "REQUESTED" as const,
    amount: "121.00",
    currency: "EUR",
    refundedPaymentReference: base.reference,
    purchasePaymentReference: base.reference,
    idempotencyKey: `lead-fee-refund:${base.reference}:1`,
    actorUserId: base.adminId,
    explanation: "Verified platform defect.",
    evidenceReference: "INC-1",
    ...patch,
  });
  const sqlError = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return String((error as Error).message);
    }
    throw new Error("expected a database error");
  };

  it("refunds end to end: the row is SUCCEEDED, the purchase REFUNDED, and the ledger / invoices / credit notes are untouched", async () => {
    const base = await confirmedPurchase();
    const ledgerBefore = await prisma.leadFeeLedgerEntry.findMany({ orderBy: { id: "asc" } });
    const { useCase, input, gateway } = world(base);
    const result = await useCase.execute(input());
    expect(result).toMatchObject({ status: "SUCCEEDED", purchaseStatus: "REFUNDED", attemptNumber: 1 });
    expect(gateway.refundRequests).toHaveLength(1);

    const row = await prisma.leadFeeRefund.findFirstOrThrow({ where: { leadPurchaseId: base.purchaseId } });
    expect(row).toMatchObject({ status: "SUCCEEDED", currency: "EUR", providerRefundId: "re_fake_1", reasonCode: "PLATFORM_ERROR" });
    expect(row.amount.toFixed(2)).toBe("121.00");
    expect(row.purchaseTransitionedAt).not.toBeNull();
    expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: base.purchaseId } })).status).toBe("REFUNDED");
    expect(await prisma.leadFeeLedgerEntry.findMany({ orderBy: { id: "asc" } })).toEqual(ledgerBefore);
    expect(await prisma.leadFeeInvoice.count()).toBe(0);
    expect(await prisma.leadFeeCreditNote.count()).toBe(0);

    // a repeat is a no-op
    expect((await useCase.execute(input())).status).toBe("SUCCEEDED");
    expect(gateway.refundRequests).toHaveLength(1);
    expect(await prisma.leadFeeRefund.count()).toBe(1);
  });

  it("is blocked while the switch is off: no row, no provider call, purchase CONFIRMED", async () => {
    const base = await confirmedPurchase();
    const { useCase, input, gateway } = world(base, false);
    await expect(useCase.execute(input())).rejects.toBeInstanceOf(LeadFeeRefundRejectedError);
    expect(gateway.refundRequests).toHaveLength(0);
    expect(await prisma.leadFeeRefund.count()).toBe(0);
    expect((await prisma.leadPurchase.findUniqueOrThrow({ where: { id: base.purchaseId } })).status).toBe("CONFIRMED");
  });

  it("genuinely concurrent executions send exactly one provider request and leave one row", async () => {
    const base = await confirmedPurchase();
    const { useCase, input, gateway } = world(base);
    const settled = await Promise.allSettled([useCase.execute(input()), useCase.execute(input()), useCase.execute(input())]);
    expect(gateway.refundRequests).toHaveLength(1);
    expect(await prisma.leadFeeRefund.count()).toBe(1);
    expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
    // losers are rejected either by the one-active-attempt rule or, once the winner's refund is visible at the provider, by the pre-check
    for (const s of settled) if (s.status === "rejected") expect(["ATTEMPT_IN_PROGRESS", "ALREADY_REFUNDED"]).toContain((s.reason as LeadFeeRefundRejectedError).reason);
  });

  describe("database guarantees", () => {
    it("allows one ACTIVE attempt per payment (partial unique index) but a new attempt after FAILED; history stays", async () => {
      const base = await confirmedPurchase();
      const first = await refunds.createAttempt(draft(base));
      await expect(refunds.createAttempt(draft(base, { attemptNumber: 2, idempotencyKey: "k2" }))).rejects.toThrow(/already exists/);
      const index = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'lead_fee_refunds_one_active_per_payment_key'`;
      expect(index[0]?.indexdef).toMatch(/UNIQUE INDEX .*\("refundedPaymentReference"\) WHERE .*REQUESTED.*PROVIDER_PENDING.*UNKNOWN.*SUCCEEDED/s);
      await refunds.updateStatus(first.id, { from: ["REQUESTED"], to: "FAILED", failureCategory: "INVALID_REQUEST" });
      const second = await refunds.createAttempt(draft(base, { attemptNumber: 2, idempotencyKey: "k2" }));
      expect(second.attemptNumber).toBe(2);
      expect((await refunds.listByPaymentReference(base.reference)).map((r) => r.status)).toEqual(["FAILED", "REQUESTED"]);
    });

    it("rejects a retry whose predecessor is not FAILED, a skipped attempt number and a duplicate idempotency key", async () => {
      const base = await confirmedPurchase();
      await sqlError(refunds.createAttempt(draft(base, { attemptNumber: 2, idempotencyKey: "k-skip" })));
      const first = await refunds.createAttempt(draft(base));
      await refunds.updateStatus(first.id, { from: ["REQUESTED"], to: "SUCCEEDED", providerRefundId: "re_1" });
      await sqlError(refunds.createAttempt(draft(base, { attemptNumber: 2, idempotencyKey: "k-after-success" })));
      await expect(refunds.createAttempt(draft(base, { idempotencyKey: first.idempotencyKey, attemptNumber: 3 }))).rejects.toThrow();
    });

    it("cross-checks the purchase: must be CONFIRMED, same payment reference, same total and EUR", async () => {
      const base = await confirmedPurchase();
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { amount: "120.99" }) }))).toMatch(/does not match a CONFIRMED purchase/);
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { purchasePaymentReference: "pi_other", refundedPaymentReference: "pi_other" }) }))).toMatch(/does not match a CONFIRMED purchase/);
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { currency: "USD" }) }))).toMatch(/lead_fee_refunds_amount_currency_check|does not match/);
      const pending = await confirmedPurchase();
      await prisma.leadPurchase.update({ where: { id: pending.purchaseId }, data: { status: "REVOKED" } }).catch(() => undefined);
      const status = (await prisma.leadPurchase.findUniqueOrThrow({ where: { id: pending.purchaseId } })).status;
      if (status !== "CONFIRMED") expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(pending) }))).toMatch(/does not match a CONFIRMED purchase/);
    });

    it("rejects a DUPLICATE_CHARGE attempt whose payment is ANY purchase's own payment (check_violation), but accepts a genuinely extra payment", async () => {
      const base = await confirmedPurchase();
      const other = await confirmedPurchase();
      const duplicate = (refundedPaymentReference: string) =>
        draft(base, { reasonCode: "DUPLICATE_CHARGE", refundedPaymentReference, idempotencyKey: `lead-fee-refund:${refundedPaymentReference}:1` });
      expect(await sqlError(prisma.leadFeeRefund.create({ data: duplicate(other.reference) }))).toMatch(/must refund an extra payment, not a purchase payment/);
      expect(await prisma.leadFeeRefund.count()).toBe(0);
      const accepted = await prisma.leadFeeRefund.create({ data: duplicate("pi_m153_extra_only") });
      expect(accepted.reasonCode).toBe("DUPLICATE_CHARGE");
    });

    it("enforces the reason / payment relationship, mandatory text and bounds", async () => {
      const base = await confirmedPurchase();
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { reasonCode: "DUPLICATE_CHARGE" }) }))).toMatch(/lead_fee_refunds_reason_payment_check/);
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { explanation: "   " }) }))).toMatch(/lead_fee_refunds_mandatory_text_check/);
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { evidenceReference: " " }) }))).toMatch(/lead_fee_refunds_mandatory_text_check/);
      expect(await sqlError(prisma.leadFeeRefund.create({ data: draft(base, { attemptNumber: 0 }) }))).toMatch(/lead_fee_refunds_amount_currency_check/);
    });

    it("keeps money / identity immutable, status forward-only, provider id write-once, and never deletes", async () => {
      const base = await confirmedPurchase();
      const row = await refunds.createAttempt(draft(base));
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { amount: "1.00" } }))).toMatch(/immutable/);
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { explanation: "rewritten" } }))).toMatch(/immutable/);
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { refundedPaymentReference: "pi_x" } }))).toMatch(/immutable/);
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { status: "SUCCEEDED" } }))).toMatch(/lead_fee_refunds_status_fields_check/);
      await refunds.updateStatus(row.id, { from: ["REQUESTED"], to: "UNKNOWN" });
      await refunds.updateStatus(row.id, { from: ["UNKNOWN"], to: "PROVIDER_PENDING", providerRefundId: "re_1" });
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { status: "UNKNOWN" } }))).toMatch(/illegal status transition/);
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { providerRefundId: "re_2" } }))).toMatch(/write-once/);
      await refunds.updateStatus(row.id, { from: ["PROVIDER_PENDING"], to: "SUCCEEDED" });
      expect(await sqlError(prisma.leadFeeRefund.update({ where: { id: row.id }, data: { status: "FAILED", failureCategory: "X" } }))).toMatch(/illegal status transition/);
      expect(await sqlError(prisma.leadFeeRefund.delete({ where: { id: row.id } }))).toMatch(/never deleted/);
      expect(await sqlError(prisma.leadPurchase.delete({ where: { id: base.purchaseId } }))).toBeTruthy();
    });

    it("stamps the purchase transition once and only for a SUCCEEDED PLATFORM_ERROR refund", async () => {
      const base = await confirmedPurchase();
      const row = await refunds.createAttempt(draft(base));
      expect(await refunds.markPurchaseTransitioned(row.id, new Date())).toBe(false);
      await refunds.updateStatus(row.id, { from: ["REQUESTED"], to: "SUCCEEDED", providerRefundId: "re_1" });
      expect(await refunds.markPurchaseTransitioned(row.id, new Date())).toBe(true);
      expect(await refunds.markPurchaseTransitioned(row.id, new Date())).toBe(false);
    });
  });
});
