import type { EventHandler } from "@/application/ports/event-bus";
import type { PaymentRefunded } from "@/domain/events/payment-refunded";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { ReverseAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/reverse-affiliate-commission.use-case";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 — Referral & Affiliate Production Wiring.
 *
 * Wires the refund/chargeback reversal side of the affiliate commission
 * lifecycle into Module 77's existing `PaymentRefunded` event — never a
 * second/parallel refund pipeline (mirrors
 * `CreateCreditNoteOnPaymentRefundedSubscriber`'s own choice of trigger
 * exactly, for the identical reason: this is the ONE point a refund has
 * actually been accepted by Stripe and durably persisted, never before).
 *
 * ## Resolution path: Payment -> Commission -> AffiliateCommission
 * `PaymentRefunded` only carries `paymentId` — this handler walks
 * `Commission.findByPaymentId` (Module 22) then
 * `AffiliateCommission.findByPlatformCommissionRefId` (Module 96) to
 * reach the row to reverse. Either step returning nothing means this
 * booking was never attributed to a partner in the first place — handled
 * identically to every other "no affiliate applies" case elsewhere in
 * this module, not an error.
 *
 * ## Full vs. partial
 * `event.newPaymentStatus` (`"REFUNDED"` | `"PARTIALLY_REFUNDED"`) is
 * Module 77's own authoritative classification — never re-derived here.
 *
 * ## Idempotency
 * Entirely delegated to `ReverseAffiliateCommissionUseCase`, keyed on
 * `event.financialAdjustmentId` — see that class's own doc comment. This
 * handler adds no idempotency logic of its own.
 *
 * ## Never blocks the refund itself
 * A failure reversing the affiliate side must never make a real customer
 * refund look like it failed — caught, reported via `FailureReporter`,
 * never rethrown, same posture as every sibling `PaymentReleaseApproved`/
 * `PaymentRefunded` subscriber in this codebase.
 */
export class ReverseAffiliateCommissionOnPaymentRefundedSubscriber implements EventHandler<PaymentRefunded> {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly commissions: CommissionRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly reverseAffiliateCommission: ReverseAffiliateCommissionUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async handle(event: PaymentRefunded): Promise<void> {
    try {
      const commission = await this.commissions.findByPaymentId(event.paymentId);
      if (!commission) return;

      const affiliateCommission = await this.affiliateCommissions.findByPlatformCommissionRefId(commission.id);
      if (!affiliateCommission) return;

      const payment = await this.payments.findById(event.paymentId);
      if (!payment) return;

      const result = await this.reverseAffiliateCommission.execute({
        affiliateCommissionId: affiliateCommission.id,
        financialAdjustmentId: event.financialAdjustmentId,
        refundedAmount: event.amount,
        paymentAmount: payment.amount,
        isFullRefund: event.newPaymentStatus === "REFUNDED",
        reason: `Refund ${event.refundId} (${event.newPaymentStatus}).`,
      });

      logger.info("affiliate.commission.reversal_processed", {
        paymentId: event.paymentId,
        affiliateCommissionId: affiliateCommission.id,
        newReversedAmount: result?.reversedAmount ?? null,
        status: result?.status ?? null,
      });
    } catch (error) {
      this.failureReporter.report(error, {
        context: "ReverseAffiliateCommissionOnPaymentRefundedSubscriber",
        paymentId: event.paymentId,
        refundId: event.refundId,
      });
    }
  }
}
