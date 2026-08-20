import { beforeEach, describe, expect, it } from "vitest";

import { ExecuteRefundUseCase } from "@/application/use-cases/refunds/execute-refund.use-case";
import { ReverseProfessionalPayoutUseCase } from "@/application/use-cases/refunds/reverse-professional-payout.use-case";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { ConflictError, PaymentGatewayError, ValidationError } from "@/domain/errors/domain-error";
import { PaymentRefunded } from "@/domain/events/payment-refunded";
import { RefundFailed } from "@/domain/events/refund-failed";
import { ProfessionalPayoutReversed } from "@/domain/events/professional-payout-reversed";
import type { PaymentRecord } from "@/domain/repositories/payment-repository";
import type { PayoutRecord } from "@/domain/repositories/payout-repository";

import { FakeDistributedLock, FakeEventBus, FakePaymentGateway, FakePayoutRepository, FakeStripeTransferGateway, FakeCommissionRepository } from "../payments/fakes";
import {
  FakeFinancialAdjustmentRepository,
  FakeFinancialLedgerRepository,
  FakeJobRepository,
  FakePaymentRepositoryWithRefunds,
  FakeRefundRepository,
  fakeJobRecord,
} from "./fakes";

function seedPayout(payouts: FakePayoutRepository, overrides: Partial<PayoutRecord> & { jobId: string }): PayoutRecord {
  const now = new Date();
  const record: PayoutRecord = {
    id: overrides.id ?? `payout-seed-${Math.random().toString(36).slice(2)}`,
    jobId: overrides.jobId,
    paymentId: overrides.paymentId ?? null,
    professionalProfileId: overrides.professionalProfileId ?? null,
    companyProfileId: overrides.companyProfileId ?? null,
    amount: overrides.amount ?? 100,
    currency: overrides.currency ?? "EUR",
    status: overrides.status ?? "PENDING",
    stripeTransferId: overrides.stripeTransferId ?? null,
    idempotencyKey: overrides.idempotencyKey ?? `payout:${overrides.jobId}`,
    failureReason: overrides.failureReason ?? null,
    attemptCount: overrides.attemptCount ?? 0,
    lastAttemptedAt: overrides.lastAttemptedAt ?? null,
    processedAt: overrides.processedAt ?? null,
    stripeReversalId: overrides.stripeReversalId ?? null,
    reversalIdempotencyKey: overrides.reversalIdempotencyKey ?? null,
    reversedAmount: overrides.reversedAmount ?? null,
    reversalFailureReason: overrides.reversalFailureReason ?? null,
    reversalAttemptCount: overrides.reversalAttemptCount ?? 0,
    reversedAt: overrides.reversedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  payouts.byId.set(record.id, record);
  return record;
}

function fakePaymentRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "customer-1",
    amount: 100,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: "pi_123",
    method: "CARD",
    failureReason: null,
    ...overrides,
  };
}

function makeSetup() {
  const refunds = new FakeRefundRepository();
  const payments = new FakePaymentRepositoryWithRefunds(refunds);
  const payouts = new FakePayoutRepository();
  const paymentGateway = new FakePaymentGateway();
  const transferGateway = new FakeStripeTransferGateway();
  const commissions = new FakeCommissionRepository();
  const jobs = new FakeJobRepository();
  const adjustments = new FakeFinancialAdjustmentRepository();
  const ledger = new FakeFinancialLedgerRepository();
  const lock = new FakeDistributedLock();
  const eventBus = new FakeEventBus();

  const createFinancialAdjustment = new CreateFinancialAdjustmentUseCase(jobs, adjustments, ledger, payments);
  const reversePayout = new ReverseProfessionalPayoutUseCase(payouts, transferGateway, commissions, createFinancialAdjustment, eventBus);
  const executeRefund = new ExecuteRefundUseCase(payments, refunds, payouts, paymentGateway, reversePayout, lock, eventBus);

  jobs.seed(fakeJobRecord({ id: "job-1" }));

  return { refunds, payments, payouts, paymentGateway, transferGateway, commissions, jobs, adjustments, ledger, lock, eventBus, executeRefund, reversePayout };
}

describe("ExecuteRefundUseCase (Module 77)", () => {
  let setup: ReturnType<typeof makeSetup>;

  beforeEach(() => {
    setup = makeSetup();
  });

  it("executes a full refund against a CAPTURED payment and moves it to REFUNDED", async () => {
    setup.payments.seed(fakePaymentRecord());

    const result = await setup.executeRefund.execute({
      financialAdjustmentId: "adj-1",
      paymentId: "payment-1",
      amount: 100,
      requestedByUserId: "admin-1",
      reason: "Customer favor",
    });

    expect(result.status).toBe("PROCESSED");
    expect(result.stripeRefundId).toBeTruthy();
    expect(setup.paymentGateway.refundCalls).toHaveLength(1);

    const payment = await setup.payments.findById("payment-1");
    expect(payment?.status).toBe("REFUNDED");

    const events = setup.eventBus.published.filter((e) => e instanceof PaymentRefunded);
    expect(events).toHaveLength(1);
  });

  it("executes a partial refund and leaves the payment PARTIALLY_REFUNDED", async () => {
    setup.payments.seed(fakePaymentRecord({ amount: 200 }));

    const result = await setup.executeRefund.execute({
      financialAdjustmentId: "adj-1",
      paymentId: "payment-1",
      amount: 50,
      requestedByUserId: "admin-1",
      reason: "Partial resolution",
    });

    expect(result.status).toBe("PROCESSED");
    const payment = await setup.payments.findById("payment-1");
    expect(payment?.status).toBe("PARTIALLY_REFUNDED");
  });

  it("rejects a refund against a payment that is not CAPTURED/PARTIALLY_REFUNDED", async () => {
    setup.payments.seed(fakePaymentRecord({ status: "PENDING" }));

    await expect(
      setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null }),
    ).rejects.toThrow(ValidationError);
    expect(setup.paymentGateway.refundCalls).toHaveLength(0);
  });

  it("rejects a refund amount exceeding the remaining refundable amount", async () => {
    setup.payments.seed(fakePaymentRecord({ amount: 100 }));

    await expect(
      setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 150, requestedByUserId: "admin-1", reason: null }),
    ).rejects.toThrow(ValidationError);
    expect(setup.paymentGateway.refundCalls).toHaveLength(0);
  });

  it("rejects a second refund once the payment is already fully REFUNDED", async () => {
    setup.payments.seed(fakePaymentRecord({ amount: 100 }));
    await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });

    await expect(
      setup.executeRefund.execute({ financialAdjustmentId: "adj-2", paymentId: "payment-1", amount: 10, requestedByUserId: "admin-1", reason: null }),
    ).rejects.toThrow(ValidationError);
  });

  it("is idempotent — the same financialAdjustmentId never calls Stripe twice", async () => {
    setup.payments.seed(fakePaymentRecord());

    const first = await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });
    const second = await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });

    expect(second.id).toBe(first.id);
    expect(setup.paymentGateway.refundCalls).toHaveLength(1);
  });

  it("concurrent refund requests for the same adjustment converge safely — exactly one Stripe refund, the loser fails fast rather than double-executing", async () => {
    setup.payments.seed(fakePaymentRecord());

    const results = await Promise.allSettled([
      setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null }),
      setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null }),
    ]);

    // The per-Job lock (shared with payout execution — see this class's
    // own "race condition protection" doc comment) means only ONE of the
    // two concurrent attempts ever reaches Stripe; the other fails fast
    // with ConflictError rather than silently double-executing. This IS
    // the safe convergence this module's spec requires: never two Stripe
    // refunds, and the loser is safely retryable (a retried call finds
    // the FinancialAdjustment's Refund row already PROCESSED — see the
    // "is idempotent" test above).
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    expect(setup.paymentGateway.refundCalls).toHaveLength(1);
    const payment = await setup.payments.findById("payment-1");
    expect(payment?.status).toBe("REFUNDED");

    // The loser's retry converges on the same, already-PROCESSED result —
    // never a second Stripe call.
    const retried = await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });
    expect(retried.status).toBe("PROCESSED");
    expect(setup.paymentGateway.refundCalls).toHaveLength(1);
  });

  it("persists failure information and never swallows a Stripe error", async () => {
    setup.payments.seed(fakePaymentRecord());
    setup.paymentGateway.nextError = new PaymentGatewayError("CARD_DECLINED", "Your card was declined.", false);

    await expect(
      setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null }),
    ).rejects.toThrow(PaymentGatewayError);

    const refund = await setup.refunds.findByFinancialAdjustmentId("adj-1");
    expect(refund?.status).toBe("FAILED");
    expect(refund?.failureReason).toContain("declined");

    const payment = await setup.payments.findById("payment-1");
    expect(payment?.status).toBe("CAPTURED"); // never mutated on failure

    const failedEvents = setup.eventBus.published.filter((e) => e instanceof RefundFailed);
    expect(failedEvents).toHaveLength(1);
  });

  it("retries a previously FAILED refund and succeeds", async () => {
    setup.payments.seed(fakePaymentRecord());
    setup.paymentGateway.nextError = new PaymentGatewayError("TEMPORARY", "Stripe hiccup.", true);

    await expect(
      setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null }),
    ).rejects.toThrow(PaymentGatewayError);

    setup.paymentGateway.nextError = null;
    const result = await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });

    expect(result.status).toBe("PROCESSED");
    const payment = await setup.payments.findById("payment-1");
    expect(payment?.status).toBe("REFUNDED");
  });

  describe("pre-payout refund (Case A)", () => {
    it("blocks a subsequent professional payout after the refund — no payout row exists yet", async () => {
      setup.payments.seed(fakePaymentRecord());

      await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });

      const payment = await setup.payments.findById("payment-1");
      // Module 76's own `ExecuteProfessionalPayoutUseCase` requires
      // `payment.status === "CAPTURED"` exactly — REFUNDED permanently
      // blocks it. No Payout row was ever created (never reached PAID),
      // so no reversal is triggered either.
      expect(payment?.status).toBe("REFUNDED");
      expect(setup.transferGateway.reversalCalls).toHaveLength(0);
    });
  });

  describe("post-payout refund (Case B)", () => {
    it("reverses an already-PAID payout after the customer refund succeeds", async () => {
      setup.payments.seed(fakePaymentRecord());
      seedPayout(setup.payouts, {
        jobId: "job-1",
        paymentId: "payment-1",
        status: "PAID",
        stripeTransferId: "tr_1",
        amount: 90,
        professionalProfileId: "pro-1",
      });
      setup.commissions.byPaymentId.set("payment-1", {
        id: "commission-1",
        paymentId: "payment-1",
        professionalProfileId: "pro-1",
        companyProfileId: null,
        rateBps: 1000,
        amount: 10,
        status: "SETTLED",
        settledAt: new Date(),
        createdAt: new Date(),
      });

      await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: "Customer favor" });

      expect(setup.transferGateway.reversalCalls).toHaveLength(1);
      const payout = await setup.payouts.findByJobId("job-1");
      expect(payout?.status).toBe("REVERSED");
      expect(payout?.stripeReversalId).toBeTruthy();

      const reversedEvents = setup.eventBus.published.filter((e) => e instanceof ProfessionalPayoutReversed);
      expect(reversedEvents).toHaveLength(1);

      // Commission reversal recorded via the existing ledger mechanism —
      // never a mutation of Commission.status itself.
      const commissionReversal = [...setup.adjustments.byId.values()].find((a) => a.type === "COMMISSION_REVERSAL");
      expect(commissionReversal).toBeDefined();
      expect(commissionReversal?.amount).toBe(10);
    });

    it("never creates a second reversal for an already-REVERSED payout", async () => {
      setup.payments.seed(fakePaymentRecord());
      seedPayout(setup.payouts, { jobId: "job-1", paymentId: "payment-1", status: "PAID", stripeTransferId: "tr_1", amount: 90 });

      await setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null });
      expect(setup.transferGateway.reversalCalls).toHaveLength(1);

      // A second, independent reversal attempt against the same payout
      // (e.g. a retried/duplicated call) must safely converge, never
      // create a second Stripe reversal.
      const payout = await setup.payouts.findByJobId("job-1");
      const second = await setup.reversePayout.execute({ payoutId: payout!.id, requestedByUserId: "admin-1", reason: null });
      expect(second.status).toBe("REVERSED");
      expect(setup.transferGateway.reversalCalls).toHaveLength(1);
    });
  });

  describe("race condition protection (Case C)", () => {
    it("fails safely with ConflictError when a payout execution already holds the per-job lock", async () => {
      setup.payments.seed(fakePaymentRecord());

      const result = await setup.lock.withLock("payout:execute:job-1", 1000, async () => {
        // Simulates a concurrent ExecuteProfessionalPayoutUseCase already
        // holding the lock for this Job.
        await expect(
          setup.executeRefund.execute({ financialAdjustmentId: "adj-1", paymentId: "payment-1", amount: 100, requestedByUserId: "admin-1", reason: null }),
        ).rejects.toThrow(ConflictError);
        return "payout-in-progress";
      });

      expect(result).toBe("payout-in-progress");
      // No Stripe refund call and no Refund row transitioned past REQUESTED.
      expect(setup.paymentGateway.refundCalls).toHaveLength(0);
      const payment = await setup.payments.findById("payment-1");
      expect(payment?.status).toBe("CAPTURED");
    });
  });
});
