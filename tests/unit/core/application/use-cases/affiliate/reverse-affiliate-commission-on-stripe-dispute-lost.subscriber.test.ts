import { describe, expect, it, vi } from "vitest";

import { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";
import { ReverseAffiliateCommissionOnStripeDisputeLostSubscriber } from "@/application/use-cases/affiliate/reverse-affiliate-commission-on-stripe-dispute-lost.subscriber";
import type { PaymentRepository, PaymentRecord } from "@/domain/repositories/payment-repository";
import type { CommissionRepository, CommissionRecord } from "@/domain/repositories/commission-repository";
import type { AffiliateCommissionRepository, AffiliateCommissionRecord } from "@/domain/repositories/affiliate-commission-repository";
import type { ReverseAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/reverse-affiliate-commission.use-case";
import type { FailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 96 — Referral & Affiliate Production Wiring: tests for the
 * chargeback/dispute mirror of the refund-reversal subscriber. Covers
 * the three named scenarios: dispute before payout, dispute after
 * commission creation (unpaid), dispute after payout already made — the
 * last of which is exercised end-to-end (PAID stays PAID) via
 * `ReverseAffiliateCommissionUseCase`'s own integration tests
 * (tests/integration/affiliate/affiliate-flows.test.ts); this file
 * focuses on the subscriber's own event-shape handling and wiring.
 */
function fakePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id: "payment-1", amount: 1000, currency: "EUR", payerId: "customer-1", jobId: "job-1", ...overrides } as unknown as PaymentRecord;
}

function fakeCommission(overrides: Partial<CommissionRecord> = {}): CommissionRecord {
  return { id: "commission-1", paymentId: "payment-1", amount: 100, ...overrides } as unknown as CommissionRecord;
}

function fakeAffiliateCommission(overrides: Partial<AffiliateCommissionRecord> = {}): AffiliateCommissionRecord {
  return { id: "affiliate-commission-1", affiliateAmount: 10, reversedAmount: 0, status: "PAID", ...overrides } as unknown as AffiliateCommissionRecord;
}

function fakePayments(payment: PaymentRecord | null): PaymentRepository {
  return { findById: vi.fn().mockResolvedValue(payment) } as unknown as PaymentRepository;
}

function fakeCommissions(commission: CommissionRecord | null): CommissionRepository {
  return { findByPaymentId: vi.fn().mockResolvedValue(commission) } as unknown as CommissionRepository;
}

function fakeAffiliateCommissions(record: AffiliateCommissionRecord | null): AffiliateCommissionRepository {
  return { findByPlatformCommissionRefId: vi.fn().mockResolvedValue(record) } as unknown as AffiliateCommissionRepository;
}

function fakeReverse(execute: ReturnType<typeof vi.fn>): ReverseAffiliateCommissionUseCase {
  return { execute } as unknown as ReverseAffiliateCommissionUseCase;
}

describe("ReverseAffiliateCommissionOnStripeDisputeLostSubscriber (Module 96)", () => {
  it("does nothing for a WON dispute — never claws back money Stripe already returned", async () => {
    const commissions = fakeCommissions(fakeCommission());
    const subscriber = new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
      fakePayments(fakePayment()),
      commissions,
      fakeAffiliateCommissions(fakeAffiliateCommission()),
      fakeReverse(vi.fn()),
    );

    await subscriber.handle(new StripeDisputeClosed("dr-1", "dp_1", "payment-1", "job-1", "WON", 1000, "EUR", null));

    expect(commissions.findByPaymentId).not.toHaveBeenCalled();
  });

  it("does nothing for a LOST dispute with no financialAdjustmentId (defensive — should not occur per Module 86's own contract)", async () => {
    const commissions = fakeCommissions(fakeCommission());
    const subscriber = new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
      fakePayments(fakePayment()),
      commissions,
      fakeAffiliateCommissions(fakeAffiliateCommission()),
      fakeReverse(vi.fn()),
    );

    await subscriber.handle(new StripeDisputeClosed("dr-1", "dp_1", "payment-1", "job-1", "LOST", 1000, "EUR", null));

    expect(commissions.findByPaymentId).not.toHaveBeenCalled();
  });

  it("does nothing when the booking was never attributed to an affiliate (no Commission/AffiliateCommission)", async () => {
    const reverse = vi.fn();
    const subscriber = new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
      fakePayments(fakePayment()),
      fakeCommissions(null),
      fakeAffiliateCommissions(null),
      fakeReverse(reverse),
    );

    await subscriber.handle(new StripeDisputeClosed("dr-1", "dp_1", "payment-1", "job-1", "LOST", 1000, "EUR", "adjustment-1"));

    expect(reverse).not.toHaveBeenCalled();
  });

  it("reverses a full-amount LOST dispute (dispute before/after commission creation, still unpaid)", async () => {
    const reverse = vi.fn().mockResolvedValue({ reversedAmount: 10, status: "REVERSED" });
    const subscriber = new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
      fakePayments(fakePayment({ amount: 1000 })),
      fakeCommissions(fakeCommission()),
      fakeAffiliateCommissions(fakeAffiliateCommission({ status: "PENDING" })),
      fakeReverse(reverse),
    );

    await subscriber.handle(new StripeDisputeClosed("dr-1", "dp_1", "payment-1", "job-1", "LOST", 1000, "EUR", "adjustment-1"));

    expect(reverse).toHaveBeenCalledWith({
      affiliateCommissionId: "affiliate-commission-1",
      financialAdjustmentId: "adjustment-1",
      refundedAmount: 1000,
      paymentAmount: 1000,
      isFullRefund: true,
      reason: expect.stringContaining("dp_1"),
    });
  });

  it("reverses a dispute against an already-PAID commission — delegates the 'stays PAID, records the clawback' behavior to ReverseAffiliateCommissionUseCase", async () => {
    const reverse = vi.fn().mockResolvedValue({ reversedAmount: 10, status: "PAID" });
    const subscriber = new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
      fakePayments(fakePayment({ amount: 1000 })),
      fakeCommissions(fakeCommission()),
      fakeAffiliateCommissions(fakeAffiliateCommission({ status: "PAID" })),
      fakeReverse(reverse),
    );

    await subscriber.handle(new StripeDisputeClosed("dr-1", "dp_1", "payment-1", "job-1", "LOST", 1000, "EUR", "adjustment-1"));

    expect(reverse).toHaveBeenCalledTimes(1);
  });

  it("never lets a downstream failure propagate — reports it via FailureReporter instead", async () => {
    const report = vi.fn();
    const failureReporter: FailureReporter = { report };
    const subscriber = new ReverseAffiliateCommissionOnStripeDisputeLostSubscriber(
      fakePayments(fakePayment()),
      fakeCommissions(fakeCommission()),
      fakeAffiliateCommissions(fakeAffiliateCommission()),
      fakeReverse(vi.fn().mockRejectedValue(new Error("boom"))),
      failureReporter,
    );

    await expect(
      subscriber.handle(new StripeDisputeClosed("dr-1", "dp_1", "payment-1", "job-1", "LOST", 1000, "EUR", "adjustment-1")),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalled();
  });
});
