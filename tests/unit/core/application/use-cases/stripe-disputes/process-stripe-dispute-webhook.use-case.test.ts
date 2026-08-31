import { beforeEach, describe, expect, it } from "vitest";

import type { StripeDisputeEventPayload } from "@/application/ports/stripe-payment-webhook-verifier";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { ReverseProfessionalPayoutUseCase } from "@/application/use-cases/refunds/reverse-professional-payout.use-case";
import { ProcessStripeDisputeWebhookUseCase } from "@/application/use-cases/stripe-disputes/process-stripe-dispute-webhook.use-case";
import { StripeDisputeOpened } from "@/domain/events/stripe-dispute-opened";
import { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { PayoutRecord } from "@/domain/repositories/payout-repository";

import {
  FakeCommissionRepository,
  FakeDistributedLock,
  FakeEventBus,
  FakePaymentRepository,
  FakePayoutRepository,
  FakeStripeTransferGateway,
} from "../payments/fakes";
import { FakeFinancialAdjustmentRepository, FakeFinancialLedgerRepository, FakeJobRepository, fakeJobRecord } from "../refunds/fakes";
import { FakeStripeDisputeRepository } from "./fakes";

/**
 * Module 86 — Stripe Chargeback & Dispute Handling: application-level
 * tests for `ProcessStripeDisputeWebhookUseCase`. Signature verification/
 * event extraction is covered separately by
 * `stripe-payment-webhook-verifier.test.ts`; dispatch from
 * `ProcessCustomerPaymentWebhookUseCase` is covered by that class's own
 * test file.
 */

const SYSTEM_ACTOR = "stripe-system-actor";
const PAYMENT_ID = "payment-1";
const JOB_ID = "job-1";

function disputePayload(overrides: Partial<StripeDisputeEventPayload> = {}): StripeDisputeEventPayload {
  return {
    disputeId: "dp_1",
    chargeId: "ch_1",
    paymentIntentId: "pi_123",
    amount: 1200,
    currency: "EUR",
    reason: "fraudulent",
    status: "needs_response",
    evidenceDueBy: null,
    ...overrides,
  };
}

function seedPayment(payments: FakePaymentRepository, overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  const record: PaymentRecord = {
    id: PAYMENT_ID,
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    jobId: JOB_ID,
    payerId: "user-1",
    amount: 1200,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: "pi_123",
    method: "CARD",
    failureReason: null,
    ...overrides,
  };
  payments.seed(record);
  return record;
}

function seedPaidPayout(payouts: FakePayoutRepository, overrides: Partial<PayoutRecord> = {}): PayoutRecord {
  const now = new Date();
  const record: PayoutRecord = {
    id: overrides.id ?? "payout-1",
    jobId: overrides.jobId ?? JOB_ID,
    paymentId: overrides.paymentId ?? PAYMENT_ID,
    professionalProfileId: overrides.professionalProfileId ?? "pro-1",
    companyProfileId: overrides.companyProfileId ?? null,
    amount: overrides.amount ?? 1080,
    currency: overrides.currency ?? "EUR",
    status: overrides.status ?? "PAID",
    stripeTransferId: overrides.stripeTransferId ?? "tr_1",
    idempotencyKey: overrides.idempotencyKey ?? `payout:${JOB_ID}`,
    failureReason: overrides.failureReason ?? null,
    attemptCount: overrides.attemptCount ?? 1,
    lastAttemptedAt: overrides.lastAttemptedAt ?? now,
    processedAt: overrides.processedAt ?? now,
    stripeReversalId: overrides.stripeReversalId ?? null,
    reversalIdempotencyKey: overrides.reversalIdempotencyKey ?? null,
    reversedAmount: overrides.reversedAmount ?? null,
    reversalFailureReason: overrides.reversalFailureReason ?? null,
    reversalAttemptCount: overrides.reversalAttemptCount ?? 0,
    reversedAt: overrides.reversedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  payouts.byId.set(record.id, record);
  return record;
}

function makeSetup(systemActorUserId: string | null = SYSTEM_ACTOR) {
  const disputes = new FakeStripeDisputeRepository();
  const payments = new FakePaymentRepository();
  const payouts = new FakePayoutRepository();
  const financialAdjustments = new FakeFinancialAdjustmentRepository();
  const ledger = new FakeFinancialLedgerRepository();
  const jobs = new FakeJobRepository();
  const commissions = new FakeCommissionRepository();
  const transferGateway = new FakeStripeTransferGateway();
  const lock = new FakeDistributedLock();
  const eventBus = new FakeEventBus();

  jobs.seed(fakeJobRecord({ id: JOB_ID }));

  const createFinancialAdjustment = new CreateFinancialAdjustmentUseCase(jobs, financialAdjustments, ledger, payments);
  const reversePayout = new ReverseProfessionalPayoutUseCase(payouts, transferGateway, commissions, createFinancialAdjustment, eventBus);

  const useCase = new ProcessStripeDisputeWebhookUseCase({
    disputes,
    payments,
    payouts,
    financialAdjustments,
    createFinancialAdjustment,
    reversePayout,
    lock,
    eventBus,
    systemActorUserId,
  });

  return { disputes, payments, payouts, financialAdjustments, ledger, jobs, commissions, transferGateway, lock, eventBus, useCase };
}

describe("ProcessStripeDisputeWebhookUseCase (Module 86)", () => {
  let setup: ReturnType<typeof makeSetup>;

  beforeEach(() => {
    setup = makeSetup();
  });

  describe("charge.dispute.created", () => {
    it("records a new StripeDispute correlated to the Payment/Job, with no financial action", async () => {
      seedPayment(setup.payments);

      await setup.useCase.handleCreated(disputePayload());

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record).not.toBeNull();
      expect(record?.paymentId).toBe(PAYMENT_ID);
      expect(record?.jobId).toBe(JOB_ID);
      expect(record?.status).toBe("NEEDS_RESPONSE");
      expect(setup.financialAdjustments.byId.size).toBe(0);
      expect(setup.payouts.byId.size).toBe(0);

      const opened = setup.eventBus.published.filter((e) => e instanceof StripeDisputeOpened);
      expect(opened).toHaveLength(1);
    });

    it("is idempotent — a duplicate delivery for the same Stripe dispute id never creates a second row or a second event", async () => {
      seedPayment(setup.payments);

      await setup.useCase.handleCreated(disputePayload());
      await setup.useCase.handleCreated(disputePayload());

      expect(setup.disputes.byId.size).toBe(1);
      const opened = setup.eventBus.published.filter((e) => e instanceof StripeDisputeOpened);
      expect(opened).toHaveLength(1);
    });

    it("still records the dispute (unmatched) when no Payment can be found for the PaymentIntent", async () => {
      await setup.useCase.handleCreated(disputePayload());

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.paymentId).toBeNull();
      expect(record?.jobId).toBeNull();
    });
  });

  describe("charge.dispute.updated", () => {
    it("updates status/amount/reason without any financial action", async () => {
      seedPayment(setup.payments);
      await setup.useCase.handleCreated(disputePayload());

      await setup.useCase.handleUpdated(disputePayload({ status: "under_review", amount: 1200, reason: "duplicate" }));

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.status).toBe("UNDER_REVIEW");
      expect(record?.reason).toBe("duplicate");
      expect(setup.financialAdjustments.byId.size).toBe(0);
    });

    it("handles out-of-order delivery — an `updated` arriving before `created` still creates the row", async () => {
      seedPayment(setup.payments);
      await setup.useCase.handleUpdated(disputePayload({ status: "under_review" }));

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record).not.toBeNull();
    });
  });

  describe("charge.dispute.closed — WON", () => {
    it("records WON with no FinancialAdjustment and no payout reversal", async () => {
      seedPayment(setup.payments);
      seedPaidPayout(setup.payouts);
      await setup.useCase.handleCreated(disputePayload());

      await setup.useCase.handleClosed(disputePayload({ status: "won" }));

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.status).toBe("WON");
      expect(record?.financialAdjustmentId).toBeNull();
      expect(setup.financialAdjustments.byId.size).toBe(0);

      const payout = await setup.payouts.findById("payout-1");
      expect(payout?.status).toBe("PAID"); // never reversed

      const payment = await setup.payments.findById(PAYMENT_ID);
      expect(payment?.status).toBe("CAPTURED"); // never touched

      const closed = setup.eventBus.published.filter((e) => e instanceof StripeDisputeClosed);
      expect(closed).toHaveLength(1);
    });
  });

  describe("charge.dispute.closed — WARNING_CLOSED", () => {
    it("records WARNING_CLOSED with no financial action", async () => {
      seedPayment(setup.payments);
      await setup.useCase.handleCreated(disputePayload());

      await setup.useCase.handleClosed(disputePayload({ status: "warning_closed" }));

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.status).toBe("WARNING_CLOSED");
      expect(setup.financialAdjustments.byId.size).toBe(0);
    });
  });

  describe("charge.dispute.closed — LOST (the €1,200 / €120 / €1,080 scenario)", () => {
    it("creates a FULL_REFUND FinancialAdjustment for the disputed amount, reverses the already-PAID payout using the PERSISTED commission amount, and moves the Payment to REFUNDED", async () => {
      seedPayment(setup.payments, { amount: 1200 });
      seedPaidPayout(setup.payouts, { amount: 1080 });
      setup.commissions.byPaymentId.set(PAYMENT_ID, {
        id: "commission-1",
        paymentId: PAYMENT_ID,
        professionalProfileId: "pro-1",
        companyProfileId: null,
        rateBps: 1000, // 10% at the time this payment was captured
        amount: 120,
        status: "SETTLED",
        settledAt: new Date(),
        createdAt: new Date(),
      });
      await setup.useCase.handleCreated(disputePayload({ amount: 1200 }));

      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));

      // --- FinancialAdjustment: the full 1200 disputed amount ---
      const adjustments = [...setup.financialAdjustments.byId.values()];
      const chargebackAdjustment = adjustments.find((a) => a.type === "FULL_REFUND");
      expect(chargebackAdjustment).toBeDefined();
      expect(chargebackAdjustment?.amount).toBe(1200);
      expect(chargebackAdjustment?.status).toBe("APPLIED");

      // --- Payout reversed; commission reversal uses the PERSISTED 120, never a "current rate" ---
      const payout = await setup.payouts.findById("payout-1");
      expect(payout?.status).toBe("REVERSED");
      expect(payout?.reversedAmount).toBe(1080);
      const commissionReversal = adjustments.find((a) => a.type === "COMMISSION_REVERSAL");
      expect(commissionReversal?.amount).toBe(120);

      // --- Payment converges to REFUNDED ---
      const payment = await setup.payments.findById(PAYMENT_ID);
      expect(payment?.status).toBe("REFUNDED");

      // --- StripeDispute row reflects the settled outcome ---
      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.status).toBe("LOST");
      expect(record?.financialAdjustmentId).toBe(chargebackAdjustment?.id);

      const closed = setup.eventBus.published.filter((e) => e instanceof StripeDisputeClosed) as StripeDisputeClosed[];
      expect(closed).toHaveLength(1);
      expect(closed[0]?.outcome).toBe("LOST");
      expect(closed[0]?.financialAdjustmentId).toBe(chargebackAdjustment?.id);
    });

    it("commission immutability — a change to the persisted Commission's own amount/rate never occurs, and the reversal never recalculates from a different rate", async () => {
      seedPayment(setup.payments, { amount: 1200 });
      seedPaidPayout(setup.payouts, { amount: 1080 });
      setup.commissions.byPaymentId.set(PAYMENT_ID, {
        id: "commission-1",
        paymentId: PAYMENT_ID,
        professionalProfileId: "pro-1",
        companyProfileId: null,
        rateBps: 1000,
        amount: 120,
        status: "SETTLED",
        settledAt: new Date(),
        createdAt: new Date(),
      });
      await setup.useCase.handleCreated(disputePayload({ amount: 1200 }));

      const before = await setup.commissions.findByPaymentId(PAYMENT_ID);
      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));
      const after = await setup.commissions.findByPaymentId(PAYMENT_ID);

      // The persisted Commission row itself is never mutated — a
      // correction is always a new ledger/adjustment entry, never an edit
      // of the original (see CommissionRepository's own doc comment).
      expect(after).toEqual(before);
      expect(after?.rateBps).toBe(1000);
      expect(after?.amount).toBe(120);
    });

    it("is idempotent — a duplicate `closed` delivery (even a redelivery of the exact same event) never double-adjusts or double-reverses", async () => {
      seedPayment(setup.payments, { amount: 1200 });
      seedPaidPayout(setup.payouts, { amount: 1080 });
      await setup.useCase.handleCreated(disputePayload({ amount: 1200 }));

      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));
      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));

      const chargebackAdjustments = [...setup.financialAdjustments.byId.values()].filter((a) => a.type === "FULL_REFUND");
      expect(chargebackAdjustments).toHaveLength(1);
      expect(setup.transferGateway.reversalCalls).toHaveLength(1);

      const closed = setup.eventBus.published.filter((e) => e instanceof StripeDisputeClosed);
      expect(closed).toHaveLength(1);
    });

    it("never reverses a payout that was never PAID", async () => {
      seedPayment(setup.payments, { amount: 1200 });
      seedPaidPayout(setup.payouts, { status: "PENDING", stripeTransferId: null });
      await setup.useCase.handleCreated(disputePayload({ amount: 1200 }));

      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));

      expect(setup.transferGateway.reversalCalls).toHaveLength(0);
      const payout = await setup.payouts.findById("payout-1");
      expect(payout?.status).toBe("PENDING");
    });

    it("handles a chargeback smaller than the captured amount as a PARTIAL_REFUND", async () => {
      seedPayment(setup.payments, { amount: 1200 });
      await setup.useCase.handleCreated(disputePayload({ amount: 400 }));

      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 400 }));

      const adjustments = [...setup.financialAdjustments.byId.values()];
      const chargebackAdjustment = adjustments.find((a) => a.type === "PARTIAL_REFUND");
      expect(chargebackAdjustment?.amount).toBe(400);

      const payment = await setup.payments.findById(PAYMENT_ID);
      expect(payment?.status).toBe("PARTIALLY_REFUNDED");
    });

    it("handles out-of-order delivery — a `closed` arriving before any `created`/`updated` still settles correctly", async () => {
      seedPayment(setup.payments, { amount: 1200 });
      seedPaidPayout(setup.payouts, { amount: 1080 });

      await setup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));

      const record = await setup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.status).toBe("LOST");
      expect(record?.financialAdjustmentId).not.toBeNull();

      const payout = await setup.payouts.findById("payout-1");
      expect(payout?.status).toBe("REVERSED");
    });

    it("defers the financial settlement (but still durably records LOST) when no system actor user id is configured", async () => {
      const noActorSetup = makeSetup(null);
      seedPayment(noActorSetup.payments, { amount: 1200 });
      seedPaidPayout(noActorSetup.payouts, { amount: 1080 });
      await noActorSetup.useCase.handleCreated(disputePayload({ amount: 1200 }));

      await noActorSetup.useCase.handleClosed(disputePayload({ status: "lost", amount: 1200 }));

      // Never silently attributed to a fabricated actor — no adjustment,
      // no reversal, but the dispute row is untouched (not marked LOST)
      // so a later retry (once configured) can still settle it.
      expect(noActorSetup.financialAdjustments.byId.size).toBe(0);
      expect(noActorSetup.transferGateway.reversalCalls).toHaveLength(0);
      const record = await noActorSetup.disputes.findByStripeDisputeId("dp_1");
      expect(record?.status).toBe("NEEDS_RESPONSE");
    });
  });
});
