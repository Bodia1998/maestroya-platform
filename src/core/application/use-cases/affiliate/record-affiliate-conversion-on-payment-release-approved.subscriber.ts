import { ValidationError } from "@/domain/errors/domain-error";
import type { EventHandler } from "@/application/ports/event-bus";
import type { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { MarketingAttributionRepository } from "@/domain/repositories/marketing-attribution-repository";
import type { RecordCommissionForPaymentUseCase } from "@/application/use-cases/financial/record-commission-for-payment.use-case";
import type { RecordConversionUseCase } from "@/application/use-cases/referral/record-conversion.use-case";
import type { RecordAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/record-affiliate-commission.use-case";
import type { FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 — Referral & Affiliate Production Wiring.
 *
 * The missing production caller for `RecordConversionUseCase`'s
 * `COMMISSION_GENERATED` event and `RecordAffiliateCommissionUseCase` —
 * both existed (Module 60/61) with zero real invocation before this
 * module (see MODULE_96 implementation report's "Confirmed unwired"
 * findings). Wired to `PaymentReleaseApproved` (Module 66) — mirrors
 * `ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber`'s own
 * choice of trigger event exactly, and for the identical reason: this is
 * the one point in the job/payment lifecycle Module 66 only ever reaches
 * once a Job is COMPLETED and its Payment is CAPTURED and release has
 * been positively approved (customer confirmed, no open dispute, no
 * trust hold, professional payout-eligible) — never quote-created,
 * quote-accepted, payment-intent-created, or authorization-only, exactly
 * as the module spec requires ("real conversion tied to the actual
 * realized/released payment state").
 *
 * ## Why this calls `RecordCommissionForPaymentUseCase` itself
 * `RecordCommissionForPaymentUseCase` is already idempotent (returns the
 * existing `Commission` row unchanged on a repeat call for the same
 * `paymentId` — see that class's own doc comment) and is the ONLY place
 * a `Commission.amount` is computed. Calling it here (rather than relying
 * on `RecordCommissionOnPaymentCapturedSubscriber` having already run) is
 * deliberate: that other subscriber fires on `PaymentCaptured`, well
 * before Module 66 release is approved, and is *expected* to no-op with a
 * deferred `ValidationError` at that point (see its own doc comment) —
 * there is no guarantee a Commission already exists by the time
 * `PaymentReleaseApproved` fires. Calling it again here, now that the
 * Module 66 gate is guaranteed satisfied, is what actually guarantees a
 * Commission row exists before this handler tries to read
 * `commission.amount` — with zero risk of double-charging, since the use
 * case's own idempotency makes a second call a pure read in the common
 * case where the other subscriber already won the race.
 *
 * ## Attribution resolution: userId -> visitorId
 * `Payment` only ever knows the paying customer's `User.id`
 * (`payerId`), never a `visitorId` — this handler is what bridges the
 * two, via `MarketingAttributionRepository.findByUserId` (added by this
 * module). A payer with no attribution row (never tracked, or tracked
 * but never registered through `/r/<code>`) simply has no affiliate to
 * pay — handled identically to every other "no affiliate applies" case
 * `RecordAffiliateCommissionUseCase` already returns `null` for, not an
 * error.
 *
 * ## Idempotency
 * Both downstream use cases are independently idempotent under a
 * redelivered/retried `PaymentReleaseApproved` (`RecordConversionUseCase`
 * on `(type, referenceId)`, `RecordAffiliateCommissionUseCase` on
 * `conversionEventId`) — see each one's own doc comment, and the
 * `@@unique` DB constraints backing both in schema.prisma. This handler
 * adds no idempotency logic of its own; it relies entirely on its
 * collaborators', per this codebase's established convention.
 *
 * ## Self-referral
 * Enforced inside `RecordAffiliateCommissionUseCase` itself (a hard
 * block, not advisory — see that class's own doc comment) — this handler
 * does not duplicate that check, only passes through what it resolved.
 *
 * ## Never blocks the release itself
 * A failure recording the conversion/affiliate-commission must never be
 * allowed to look like the payment release itself failed — this handler
 * catches everything, reports it via `FailureReporter` (mirrors
 * `ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber`'s sibling
 * `ExecutePayoutOnReleaseApprovedSubscriber`'s own isolation — one
 * subscriber's failure must never block another for the same event, see
 * `SynchronousEventBus`'s own "handler failure contract"), and returns.
 */
export class RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber implements EventHandler<PaymentReleaseApproved> {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly attributions: MarketingAttributionRepository,
    private readonly recordCommission: RecordCommissionForPaymentUseCase,
    private readonly recordConversion: RecordConversionUseCase,
    private readonly recordAffiliateCommission: RecordAffiliateCommissionUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    /** Module 96 — Referral & Affiliate Production Wiring: optional, same
     *  "every pre-existing caller keeps compiling unchanged" convention
     *  used throughout this module — a `null` here means
     *  `attributableCostAmount` stays `0` (the pre-fee-capture behavior);
     *  every real production composition (`affiliate/compose.ts`) always
     *  supplies the real ledger, so the profit-base formula genuinely
     *  consumes the real captured Stripe fee in production. */
    private readonly financialLedger: FinancialLedgerRepository | null = null,
  ) {}

  async handle(event: PaymentReleaseApproved): Promise<void> {
    if (!event.paymentId) return;

    try {
      const payment = await this.payments.findById(event.paymentId);
      if (!payment) return;

      const attribution = await this.attributions.findByUserId(payment.payerId);
      if (!attribution) {
        // No tracked visitor ever linked to this customer — nothing to
        // attribute, expected for the overwhelming majority of bookings.
        return;
      }

      let commission;
      try {
        commission = await this.recordCommission.execute(event.paymentId);
      } catch (error) {
        if (error instanceof ValidationError) {
          // Same "expected, not a failure" treatment
          // `RecordCommissionOnPaymentCapturedSubscriber` gives this
          // exact error shape — should not actually occur here (the
          // Module 66 gate this event itself represents is already
          // satisfied), but never treated as a hard failure if it
          // somehow does.
          logger.info("affiliate.conversion.commission_not_ready", {
            paymentId: event.paymentId,
            reason: error.message,
          });
          return;
        }
        throw error;
      }

      const conversion = await this.recordConversion.execute({
        visitorId: attribution.visitorId,
        type: "COMMISSION_GENERATED",
        referenceId: commission.id,
        revenueAmount: commission.amount,
      });

      const attributableCostAmount = await this.resolveStripeFee(event.paymentId);

      const affiliateCommission = await this.recordAffiliateCommission.execute({
        visitorId: attribution.visitorId,
        conversionEventId: conversion.id,
        platformCommissionRefId: commission.id,
        platformCommissionAmount: commission.amount,
        attributableCostAmount,
      });

      logger.info("affiliate.conversion.recorded", {
        paymentId: event.paymentId,
        conversionEventId: conversion.id,
        affiliateCommissionCreated: affiliateCommission !== null,
        attributableCostAmount,
      });
    } catch (error) {
      this.failureReporter.report(error, {
        context: "RecordAffiliateConversionOnPaymentReleaseApprovedSubscriber",
        paymentId: event.paymentId,
        jobId: event.jobId,
      });
    }
  }

  /**
   * Module 96 — Referral & Affiliate Production Wiring: reads the actual
   * Stripe processing fee already captured for this payment (see
   * `ProcessCustomerPaymentWebhookUseCase.handleChargeUpdated`) off the
   * append-only ledger — never a hardcoded percentage, never recomputed.
   * `Transaction.amount` for a `STRIPE_FEE` row is always negative (an
   * outflow); this returns its absolute value, the plain-positive "cost"
   * shape `calculateAffiliateCommission` expects.
   *
   * ## Honest limitation: fee not yet captured
   * Stripe's own `charge.updated` (the fee's only trigger) can arrive
   * after this subscriber runs — `PaymentReleaseApproved` fires once a
   * completed Job's payout is approved, normally well after capture, but
   * there is no hard ordering guarantee between the two independent
   * webhook streams. When no `STRIPE_FEE` row exists yet, this returns
   * `0` (the previous, pre-Module-96-fee-capture behavior) rather than
   * blocking commission creation — `attributableCostAmount` is not
   * retroactively corrected if the fee arrives later, which is a real,
   * acknowledged gap (see the implementation report's Remaining
   * Limitations), not a silent one: `affiliate.commission.fee_unavailable_at_creation`
   * is logged whenever this happens, so it's observable and auditable.
   */
  private async resolveStripeFee(paymentId: string): Promise<number> {
    if (!this.financialLedger) return 0;
    const entries = await this.financialLedger.listForPayment(paymentId);
    const feeEntry = entries.find((entry) => entry.type === "STRIPE_FEE");
    if (!feeEntry) {
      logger.info("affiliate.commission.fee_unavailable_at_creation", { paymentId });
      return 0;
    }
    return Math.abs(feeEntry.amount);
  }
}
