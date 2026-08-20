import { beforeEach, describe, expect, it } from "vitest";

import { ReverseProfessionalPayoutUseCase } from "@/application/use-cases/refunds/reverse-professional-payout.use-case";
import { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import { NotFoundError, StripeTransferError, ValidationError } from "@/domain/errors/domain-error";
import { PayoutReversalFailed } from "@/domain/events/payout-reversal-failed";
import type { PayoutRecord } from "@/domain/repositories/payout-repository";

import { FakeEventBus, FakePayoutRepository, FakeStripeTransferGateway, FakeCommissionRepository } from "../payments/fakes";
import { FakeFinancialAdjustmentRepository, FakeFinancialLedgerRepository, FakeJobRepository, fakeJobRecord } from "./fakes";

function seedPayout(payouts: FakePayoutRepository, overrides: Partial<PayoutRecord> & { jobId: string }): PayoutRecord {
  const now = new Date();
  const record: PayoutRecord = {
    id: overrides.id ?? "payout-1",
    jobId: overrides.jobId,
    paymentId: overrides.paymentId ?? "payment-1",
    professionalProfileId: overrides.professionalProfileId ?? "pro-1",
    companyProfileId: overrides.companyProfileId ?? null,
    amount: overrides.amount ?? 90,
    currency: overrides.currency ?? "EUR",
    status: overrides.status ?? "PAID",
    stripeTransferId: overrides.stripeTransferId ?? "tr_1",
    idempotencyKey: overrides.idempotencyKey ?? `payout:${overrides.jobId}`,
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

function makeSetup() {
  const payouts = new FakePayoutRepository();
  const transferGateway = new FakeStripeTransferGateway();
  const commissions = new FakeCommissionRepository();
  const jobs = new FakeJobRepository();
  const adjustments = new FakeFinancialAdjustmentRepository();
  const ledger = new FakeFinancialLedgerRepository();
  const eventBus = new FakeEventBus();

  jobs.seed(fakeJobRecord({ id: "job-1" }));

  const createFinancialAdjustment = new CreateFinancialAdjustmentUseCase(jobs, adjustments, ledger, {
    findByJobId: async () => [],
    listForPayer: async () => [],
    sumProcessedRefunds: async () => 0,
    findByStripePaymentIntentId: async () => null,
    findActiveByQuoteId: async () => null,
    findById: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    updateStatus: async () => {
      throw new Error("not used");
    },
  });

  const reversePayout = new ReverseProfessionalPayoutUseCase(payouts, transferGateway, commissions, createFinancialAdjustment, eventBus);

  return { payouts, transferGateway, commissions, jobs, adjustments, eventBus, reversePayout };
}

describe("ReverseProfessionalPayoutUseCase (Module 77)", () => {
  let setup: ReturnType<typeof makeSetup>;

  beforeEach(() => {
    setup = makeSetup();
  });

  it("reverses a PAID payout's full amount", async () => {
    seedPayout(setup.payouts, { jobId: "job-1" });

    const result = await setup.reversePayout.execute({ payoutId: "payout-1", requestedByUserId: "admin-1", reason: null });

    expect(result.status).toBe("REVERSED");
    expect(result.reversedAmount).toBe(90);
    expect(setup.transferGateway.reversalCalls).toHaveLength(1);
    expect(setup.transferGateway.reversalCalls[0]?.stripeTransferId).toBe("tr_1");
  });

  it("throws NotFoundError for an unknown payout", async () => {
    await expect(setup.reversePayout.execute({ payoutId: "missing", requestedByUserId: "admin-1", reason: null })).rejects.toThrow(NotFoundError);
  });

  it("rejects reversing a payout that was never PAID", async () => {
    seedPayout(setup.payouts, { jobId: "job-1", status: "PENDING", stripeTransferId: null });
    await expect(setup.reversePayout.execute({ payoutId: "payout-1", requestedByUserId: "admin-1", reason: null })).rejects.toThrow(ValidationError);
    expect(setup.transferGateway.reversalCalls).toHaveLength(0);
  });

  it("is idempotent — reversing an already-REVERSED payout is a safe no-op", async () => {
    seedPayout(setup.payouts, { jobId: "job-1", status: "REVERSED", stripeReversalId: "trr_1", reversedAmount: 90 });
    const result = await setup.reversePayout.execute({ payoutId: "payout-1", requestedByUserId: "admin-1", reason: null });
    expect(result.status).toBe("REVERSED");
    expect(setup.transferGateway.reversalCalls).toHaveLength(0);
  });

  it("persists a failed reversal — never silently marks REVERSED when Stripe rejects it", async () => {
    seedPayout(setup.payouts, { jobId: "job-1" });
    setup.transferGateway.nextReversalError = new StripeTransferError("INSUFFICIENT_BALANCE", "Insufficient balance.", false);

    await expect(setup.reversePayout.execute({ payoutId: "payout-1", requestedByUserId: "admin-1", reason: null })).rejects.toThrow(StripeTransferError);

    const payout = await setup.payouts.findById("payout-1");
    expect(payout?.status).toBe("PAID"); // never flipped to REVERSED
    expect(payout?.reversalFailureReason).toContain("Insufficient balance");

    const failedEvents = setup.eventBus.published.filter((e) => e instanceof PayoutReversalFailed);
    expect(failedEvents).toHaveLength(1);
  });

  it("duplicate reversal attempts converge — a concurrent retry after a successful reversal returns the same result without a second Stripe call", async () => {
    seedPayout(setup.payouts, { jobId: "job-1" });

    const first = await setup.reversePayout.execute({ payoutId: "payout-1", requestedByUserId: "admin-1", reason: null });
    const second = await setup.reversePayout.execute({ payoutId: "payout-1", requestedByUserId: "admin-1", reason: null });

    expect(first.stripeReversalId).toBe(second.stripeReversalId);
    expect(setup.transferGateway.reversalCalls).toHaveLength(1);
  });
});
