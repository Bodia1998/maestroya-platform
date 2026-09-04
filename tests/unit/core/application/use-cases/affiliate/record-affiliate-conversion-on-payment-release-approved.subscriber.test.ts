import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/domain/errors/domain-error";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber } from "@/application/use-cases/affiliate/record-affiliate-conversion-on-payment-release-approved.subscriber";
import type { PaymentRepository, PaymentRecord } from "@/domain/repositories/payment-repository";
import type { MarketingAttributionRepository, MarketingAttributionRecord } from "@/domain/repositories/marketing-attribution-repository";
import type { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import type { RecordConversionUseCase } from "@/application/use-cases/referral/record-conversion.use-case";
import type { RecordAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/record-affiliate-commission.use-case";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import type { FinancialLedgerRepository, FinancialTransactionRecord } from "@/domain/repositories/financial-ledger-repository";

/**
 * Module 96 — Referral & Affiliate Production Wiring: tests for the
 * subscriber that finally gives `RecordConversionUseCase`'s
 * `COMMISSION_GENERATED` path and `RecordAffiliateCommissionUseCase` a
 * real production caller, triggered off the real realized/released
 * payment state (`PaymentReleaseApproved`, Module 66) — never
 * quote-created/accepted/authorization-only.
 */
function fakePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "payment-1",
    serviceRequestId: "sr-1",
    quoteId: "quote-1",
    jobId: "job-1",
    payerId: "customer-1",
    amount: 1000,
    currency: "EUR",
    status: "CAPTURED",
    capturedAt: new Date(),
    stripePaymentIntentId: "pi_1",
    method: "CARD",
    failureReason: null,
    refundedAmount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentRecord;
}

function fakeAttribution(overrides: Partial<MarketingAttributionRecord> = {}): MarketingAttributionRecord {
  return {
    id: "attribution-1",
    visitorId: "visitor-1",
    firstSource: "TELEGRAM",
    firstCampaign: null,
    firstReferralCode: "telegram_valencia",
    firstVisitAt: new Date(),
    lastSource: "TELEGRAM",
    lastCampaign: null,
    lastReferralCode: "telegram_valencia",
    lastVisitAt: new Date(),
    userId: "customer-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePayments(payment: PaymentRecord | null): PaymentRepository {
  return { findById: vi.fn().mockResolvedValue(payment) } as unknown as PaymentRepository;
}

function fakeAttributions(attribution: MarketingAttributionRecord | null): MarketingAttributionRepository {
  return { findByUserId: vi.fn().mockResolvedValue(attribution) } as unknown as MarketingAttributionRepository;
}

function fakeRecordCommission(execute: ReturnType<typeof vi.fn>): RecordCommissionForPaymentUseCase {
  return { execute } as unknown as RecordCommissionForPaymentUseCase;
}

function fakeRecordConversion(execute: ReturnType<typeof vi.fn>): RecordConversionUseCase {
  return { execute } as unknown as RecordConversionUseCase;
}

function fakeRecordAffiliateCommission(execute: ReturnType<typeof vi.fn>): RecordAffiliateCommissionUseCase {
  return { execute } as unknown as RecordAffiliateCommissionUseCase;
}

function fakeLedger(entries: FinancialTransactionRecord[]): FinancialLedgerRepository {
  return { listForPayment: vi.fn().mockResolvedValue(entries) } as unknown as FinancialLedgerRepository;
}

function stripeFeeEntry(paymentId: string, feeAmount: number): FinancialTransactionRecord {
  return {
    id: "fee-1",
    paymentId,
    payoutId: null,
    refundId: null,
    commissionId: null,
    type: "STRIPE_FEE",
    status: "COMPLETED",
    amount: -feeAmount,
    currency: "EUR",
    description: null,
    idempotencyKey: `stripe-fee:${paymentId}`,
    createdAt: new Date(),
  };
}

describe("RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber (Module 96)", () => {
  it("does nothing when the event carries no paymentId", async () => {
    const payments = fakePayments(null);
    const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
      payments,
      fakeAttributions(null),
      fakeRecordCommission(vi.fn()),
      fakeRecordConversion(vi.fn()),
      fakeRecordAffiliateCommission(vi.fn()),
    );

    await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", null));

    expect(payments.findById).not.toHaveBeenCalled();
  });

  it("does nothing when the payer has no tracked attribution (the overwhelming majority of bookings)", async () => {
    const recordCommission = vi.fn();
    const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
      fakePayments(fakePayment()),
      fakeAttributions(null),
      fakeRecordCommission(recordCommission),
      fakeRecordConversion(vi.fn()),
      fakeRecordAffiliateCommission(vi.fn()),
    );

    await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

    expect(recordCommission).not.toHaveBeenCalled();
  });

  it("records the conversion and the affiliate commission from a real realized-commission amount, for an attributed payer", async () => {
    const recordCommission = vi.fn().mockResolvedValue({ id: "commission-1", amount: 100 });
    const recordConversion = vi.fn().mockResolvedValue({ id: "conversion-1" });
    const recordAffiliateCommission = vi.fn().mockResolvedValue({ id: "affiliate-commission-1", affiliateAmount: 10 });

    const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
      fakePayments(fakePayment()),
      fakeAttributions(fakeAttribution()),
      fakeRecordCommission(recordCommission),
      fakeRecordConversion(recordConversion),
      fakeRecordAffiliateCommission(recordAffiliateCommission),
    );

    await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

    expect(recordCommission).toHaveBeenCalledWith("payment-1");
    expect(recordConversion).toHaveBeenCalledWith({
      visitorId: "visitor-1",
      type: "COMMISSION_GENERATED",
      referenceId: "commission-1",
      revenueAmount: 100,
    });
    expect(recordAffiliateCommission).toHaveBeenCalledWith({
      visitorId: "visitor-1",
      conversionEventId: "conversion-1",
      platformCommissionRefId: "commission-1",
      platformCommissionAmount: 100,
      attributableCostAmount: 0,
    });
  });

  describe("Module 96 — actual Stripe fee wired into the profit base", () => {
    it("€1000 payment / €100 commission / €15 real Stripe fee -> €85 profit base -> passes attributableCostAmount:15", async () => {
      const recordCommission = vi.fn().mockResolvedValue({ id: "commission-1", amount: 100 });
      const recordConversion = vi.fn().mockResolvedValue({ id: "conversion-1" });
      const recordAffiliateCommission = vi.fn().mockResolvedValue({ id: "affiliate-commission-1", affiliateAmount: 8.5 });
      const ledger = fakeLedger([stripeFeeEntry("payment-1", 15)]);

      const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
        fakePayments(fakePayment({ amount: 1000 })),
        fakeAttributions(fakeAttribution()),
        fakeRecordCommission(recordCommission),
        fakeRecordConversion(recordConversion),
        fakeRecordAffiliateCommission(recordAffiliateCommission),
        undefined,
        ledger,
      );

      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

      // The 8.50 affiliate reward itself (10% of the 85 profit base) is
      // computed by calculateAffiliateCommission inside
      // RecordAffiliateCommissionUseCase — see
      // affiliate-commission-policy.test.ts for that formula's own
      // dedicated unit coverage. This subscriber's own job, verified
      // here, is only ever supplying the correct real
      // attributableCostAmount input to it.
      expect(recordAffiliateCommission).toHaveBeenCalledWith({
        visitorId: "visitor-1",
        conversionEventId: "conversion-1",
        platformCommissionRefId: "commission-1",
        platformCommissionAmount: 100,
        attributableCostAmount: 15,
      });
    });

    it("defaults to attributableCostAmount:0 (logged, not blocked) when the fee has not arrived yet", async () => {
      const recordAffiliateCommission = vi.fn().mockResolvedValue({ id: "affiliate-commission-1", affiliateAmount: 10 });
      const ledger = fakeLedger([]); // no STRIPE_FEE row yet

      const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
        fakePayments(fakePayment()),
        fakeAttributions(fakeAttribution()),
        fakeRecordCommission(vi.fn().mockResolvedValue({ id: "commission-1", amount: 100 })),
        fakeRecordConversion(vi.fn().mockResolvedValue({ id: "conversion-1" })),
        fakeRecordAffiliateCommission(recordAffiliateCommission),
        undefined,
        ledger,
      );

      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

      expect(recordAffiliateCommission).toHaveBeenCalledWith(
        expect.objectContaining({ attributableCostAmount: 0 }),
      );
    });

    it("ignores an unrelated ledger entry type for the same payment and still resolves the real STRIPE_FEE row", async () => {
      const recordAffiliateCommission = vi.fn().mockResolvedValue({ id: "affiliate-commission-1", affiliateAmount: 8.5 });
      const commissionEntry: FinancialTransactionRecord = {
        id: "tx-commission",
        paymentId: "payment-1",
        payoutId: null,
        refundId: null,
        commissionId: "commission-1",
        type: "COMMISSION",
        status: "COMPLETED",
        amount: 100,
        currency: "EUR",
        description: null,
        idempotencyKey: "commission:payment-1",
        createdAt: new Date(),
      };
      const ledger = fakeLedger([commissionEntry, stripeFeeEntry("payment-1", 15)]);

      const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
        fakePayments(fakePayment()),
        fakeAttributions(fakeAttribution()),
        fakeRecordCommission(vi.fn().mockResolvedValue({ id: "commission-1", amount: 100 })),
        fakeRecordConversion(vi.fn().mockResolvedValue({ id: "conversion-1" })),
        fakeRecordAffiliateCommission(recordAffiliateCommission),
        undefined,
        ledger,
      );

      await subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"));

      expect(recordAffiliateCommission).toHaveBeenCalledWith(
        expect.objectContaining({ attributableCostAmount: 15 }),
      );
    });
  });

  it("treats the expected 'not release-approved yet' ValidationError as a routine no-op, never a failure", async () => {
    const recordConversion = vi.fn();
    const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
      fakePayments(fakePayment()),
      fakeAttributions(fakeAttribution()),
      fakeRecordCommission(vi.fn().mockRejectedValue(new ValidationError("not yet"))),
      fakeRecordConversion(recordConversion),
      fakeRecordAffiliateCommission(vi.fn()),
    );

    await expect(subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"))).resolves.toBeUndefined();
    expect(recordConversion).not.toHaveBeenCalled();
  });

  it("never lets a downstream failure propagate — reports it via FailureReporter instead", async () => {
    const report = vi.fn();
    const failureReporter: FailureReporter = { report };
    const subscriber = new RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber(
      fakePayments(fakePayment()),
      fakeAttributions(fakeAttribution()),
      fakeRecordCommission(vi.fn().mockRejectedValue(new Error("boom"))),
      fakeRecordConversion(vi.fn()),
      fakeRecordAffiliateCommission(vi.fn()),
      failureReporter,
    );

    await expect(subscriber.handle(new PaymentReleaseApproved("job-1", "confirmation-1", "payment-1"))).resolves.toBeUndefined();
    expect(report).toHaveBeenCalled();
  });
});
