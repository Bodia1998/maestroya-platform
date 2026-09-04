import type { EventHandler } from "@/application/ports/event-bus";
import type { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { AffiliateCommissionRepository } from "@/domain/repositories/affiliate-commission-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { ReverseAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/reverse-affiliate-commission.use-case";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { logger } from "@/infrastructure/observability/logger";

/**
 * Module 96 — Referral & Affiliate Production Wiring.
 *
 * The chargeback/dispute side of the affiliate commission reversal
 * lifecycle — the mirror of
 * `ReverseAffiliateCommissionOnPaymentRefundedSubscriber` (refunds), but
 * hooked to Module 86's existing Stripe dispute lifecycle
 * (`ProcessStripeDisputeWebhookUseCase`'s own `StripeDisputeClosed`
 * event) instead of `PaymentRefunded` — never a second/parallel dispute
 * pipeline. Mirrors `CreateCreditNoteOnStripeDisputeLostSubscriber`'s own
 * choice of trigger and guard clause exactly.
 *
 * ## Only LOST, only with a Payment + FinancialAdjustment
 * `WON`/`WARNING_CLOSED` never reach this far — `financialAdjustmentId`
 * is `null` for both (Stripe itself already returned the disputed funds;
 * there is nothing for this platform to claw back — see
 * `StripeDisputeClosed`'s own doc comment). A `LOST` dispute against a
 * booking with no affiliate attribution (no `Commission` or no
 * `AffiliateCommission` derived from it) is likewise a silent no-op, the
 * same "no affiliate applies" case used everywhere else in this module.
 *
 * ## Reuses the exact same reversal mechanism as a refund
 * `ReverseAffiliateCommissionUseCase` does not know or care whether the
 * money left via a refund or a lost dispute — both are "this much of the
 * realized payment was clawed back from the platform," expressed
 * identically as `refundedAmount`/`paymentAmount`/`isFullRefund` (a
 * dispute is treated as "full" when its own disputed `amount` covers the
 * entire Payment, exactly like a full Stripe refund would — Stripe
 * disputes are almost always for the full charge amount in practice, but
 * this still degrades correctly to a proportional reversal for the rare
 * partial-amount case). This is what gives this module the three
 * required scenarios for free, with no dispute-specific branching:
 *   - **Dispute before any affiliate payout** — commission still
 *     `PENDING`/`APPROVED` -> reversed to `REVERSED`, net balance 0.
 *   - **Dispute after commission creation** (but still unpaid) — same
 *     path, same outcome; timing relative to `RecordAffiliateCommissionUseCase`
 *     makes no difference, only current status does.
 *   - **Dispute after the affiliate was already paid** — the commission
 *     stays `PAID` (the money already left the platform), and the
 *     reversal ledger row records the clawback owed for a future
 *     payout/reconciliation — it never pretends to claw back money that
 *     has already left the platform's own control (see
 *     `ReverseAffiliateCommissionUseCase`'s own doc comment on this exact
 *     "PAID stays PAID" behavior, shared verbatim with the refund path).
 *
 * ## Idempotency
 * Entirely delegated to `ReverseAffiliateCommissionUseCase`, keyed on
 * `event.financialAdjustmentId` (Module 86's own dispute-loss
 * adjustment) — the same DB-unique-constrained ledger this module's
 * refund path already uses. `ProcessStripeDisputeWebhookUseCase` itself
 * only ever publishes `StripeDisputeClosed` once per dispute (see that
 * event's own doc comment), so a duplicate delivery is not expected in
 * practice, but this handler adds no idempotency logic of its own either
 * way — it is safe purely because its one collaborator already is.
 *
 * ## Never blocks dispute processing itself
 * Caught, reported via `FailureReporter`, never rethrown — a failure
 * reversing the affiliate side must never make a real Stripe dispute
 * resolution look like it failed.
 */
export class ReverseAffiliateCommissionOnStripeDisputeLostSubscriber implements EventHandler<StripeDisputeClosed> {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly commissions: CommissionRepository,
    private readonly affiliateCommissions: AffiliateCommissionRepository,
    private readonly reverseAffiliateCommission: ReverseAffiliateCommissionUseCase,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async handle(event: StripeDisputeClosed): Promise<void> {
    if (event.outcome !== "LOST" || !event.paymentId || !event.financialAdjustmentId) return;

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
        isFullRefund: event.amount >= payment.amount,
        reason: `Lost Stripe dispute ${event.stripeDisputeId}.`,
      });

      logger.info("affiliate.commission.dispute_reversal_processed", {
        paymentId: event.paymentId,
        stripeDisputeId: event.stripeDisputeId,
        affiliateCommissionId: affiliateCommission.id,
        newReversedAmount: result?.reversedAmount ?? null,
        status: result?.status ?? null,
      });
    } catch (error) {
      this.failureReporter.report(error, {
        context: "ReverseAffiliateCommissionOnStripeDisputeLostSubscriber",
        paymentId: event.paymentId,
        stripeDisputeId: event.stripeDisputeId,
      });
    }
  }
}
