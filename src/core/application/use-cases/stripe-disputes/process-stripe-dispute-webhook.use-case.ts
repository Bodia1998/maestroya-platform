import { ValidationError } from "@/domain/errors/domain-error";
import type { StripeDisputeEventPayload } from "@/application/ports/stripe-payment-webhook-verifier";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { PayoutRepository } from "@/domain/repositories/payout-repository";
import { REFUND_TYPE_ADJUSTMENTS, type FinancialAdjustmentRepository } from "@/domain/repositories/financial-adjustment-repository";
import type {
  StripeDisputeRecord,
  StripeDisputeRepository,
  StripeDisputeStatusValue,
} from "@/domain/repositories/stripe-dispute-repository";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import type { CreateFinancialAdjustmentUseCase } from "@/application/use-cases/financial/create-financial-adjustment.use-case";
import type { ReverseProfessionalPayoutUseCase } from "@/application/use-cases/refunds/reverse-professional-payout.use-case";
import { decideStripeDisputeFinancialOutcome } from "@/domain/services/stripe-dispute-financial-outcome";
import { StripeDisputeOpened } from "@/domain/events/stripe-dispute-opened";
import { StripeDisputeClosed } from "@/domain/events/stripe-dispute-closed";
import { logger } from "@/infrastructure/observability/logger";

/** Same lock namespace `ExecuteRefundUseCase`/`ExecuteProfessionalPayoutUseCase`
 *  already use (`payout:execute:<jobId>`) — see `ExecuteRefundUseCase`'s
 *  own doc comment on "race condition protection" for why reusing this
 *  exact key (not a parallel `stripe-dispute:<jobId>` key) is what
 *  actually gives mutual exclusion between a lost-dispute settlement, a
 *  refund, and a payout execution for the same Job. */
function payoutLockKey(jobId: string): string {
  return `payout:execute:${jobId}`;
}

const LOCK_TTL_MS = 30_000;

/** Stripe's own raw `Dispute.status` values that have not yet reached a
 *  final outcome — see `StripeDisputeEventPayload.status`'s own doc
 *  comment for why this platform never interprets the raw string beyond
 *  this open/closed split. Every `"warning_needs_response"`/
 *  `"warning_under_review"` variant Stripe sends collapses to
 *  `UNDER_REVIEW` here — this platform never branches financial behavior
 *  on the finer distinction. */
const NEEDS_RESPONSE_STATUSES = new Set(["warning_needs_response", "needs_response"]);
const UNDER_REVIEW_STATUSES = new Set(["warning_under_review", "under_review"]);

function mapOpenStatus(stripeStatus: string): StripeDisputeStatusValue {
  if (NEEDS_RESPONSE_STATUSES.has(stripeStatus)) return "NEEDS_RESPONSE";
  if (UNDER_REVIEW_STATUSES.has(stripeStatus)) return "UNDER_REVIEW";
  // Defensive default for any future/unrecognized Stripe status string
  // delivered on `created`/`updated` — never crash webhook processing
  // over an unrecognized-but-still-open status; treat it as needing
  // attention (the least assuming choice) rather than guessing terminal.
  return "NEEDS_RESPONSE";
}

function mapFinalStatus(stripeStatus: string): "WON" | "LOST" | "WARNING_CLOSED" | null {
  if (stripeStatus === "won") return "WON";
  if (stripeStatus === "lost") return "LOST";
  if (stripeStatus === "warning_closed") return "WARNING_CLOSED";
  return null;
}

export interface ProcessStripeDisputeWebhookDeps {
  disputes: StripeDisputeRepository;
  payments: PaymentRepository;
  payouts: PayoutRepository;
  financialAdjustments: FinancialAdjustmentRepository;
  createFinancialAdjustment: CreateFinancialAdjustmentUseCase;
  reversePayout: ReverseProfessionalPayoutUseCase;
  lock: DistributedLock;
  eventBus: EventBus;
  /** Module 86 — Stripe Chargeback & Dispute Handling: the `User.id`
   *  every dispute-driven, webhook-triggered `FinancialAdjustment`/
   *  payout reversal is attributed to — there is no human admin actor
   *  for a Stripe-resolved chargeback (see `env.STRIPE_DISPUTE_SYSTEM_USER_ID`'s
   *  own doc comment for why this is a required, explicitly-configured
   *  id rather than a fabricated one). `null` only when unconfigured —
   *  see `handleClosed`'s own doc comment for the fail-safe (never
   *  fail-silent) behavior that results. */
  systemActorUserId: string | null;
  failureReporter?: FailureReporter;
}

/**
 * Module 86 — Stripe Chargeback & Dispute Handling.
 *
 * The application-layer use case `ProcessCustomerPaymentWebhookUseCase`
 * delegates every `charge.dispute.*` event to, once the Route Handler and
 * that outer use case have already verified the inbound request's
 * signature and claimed `(STRIPE_PAYMENTS, event.id)` idempotency — this
 * class is never itself given a raw body, signature header, or Stripe
 * event id to claim; see that use case's own doc comment for the exact
 * division of responsibility.
 *
 * ## Which events this platform acts on, and why
 * `charge.dispute.created` — records the dispute (observability +
 * correlation to a Payment/Job) but takes NO financial action; Stripe's
 * final outcome is not yet known (see this module's own
 * MODULE_86_IMPLEMENTATION_REPORT.md, "Dispute opened"). `charge.dispute.updated`
 * — keeps the tracked status/amount/evidence-deadline current for admin
 * visibility; also never a financial action (Stripe's own documented
 * behavior: evidence submission/status changes before `closed` never by
 * themselves change who has the money). `charge.dispute.closed` — the
 * ONE event that ever creates a `FinancialAdjustment` or reverses a
 * Payout, and only when Stripe's own final status is `lost` — see
 * `decideStripeDisputeFinancialOutcome`'s own doc comment for the full
 * WON/LOST/WARNING_CLOSED mapping. `charge.dispute.funds_withdrawn`/
 * `charge.dispute.funds_reinstated` are deliberately not subscribed to at
 * all (see the webhook verifier adapter's own doc comment).
 *
 * ## Idempotency (three independent layers)
 * 1. `(STRIPE_PAYMENTS, event.id)` — the outer `ProcessCustomerPaymentWebhookUseCase`'s
 *    own claim, guards against the exact same webhook *delivery* being
 *    processed twice.
 * 2. `stripe_disputes.stripeDisputeId` (`@unique`) — guards against two
 *    DIFFERENT Stripe event ids that both refer to the same dispute (a
 *    `created` retried under a new id, a `closed` redelivered under a new
 *    id) from ever producing two `StripeDispute` rows or, via
 *    `markClosed`'s own terminal-status check, two financial outcomes.
 * 3. `CreateFinancialAdjustmentUseCase`'s own deterministic idempotency
 *    key (`externalDisputeReference`, this module's own minimal extension
 *    of that use case) plus `PayoutRepository`/`ReverseProfessionalPayoutUseCase`'s
 *    own compare-and-swap guards — even if layers 1-2 were somehow
 *    bypassed, a duplicate `LOST` settlement can still never double-apply
 *    a refund-type adjustment or reverse the same Payout twice.
 *
 * ## Commission immutability
 * This class never reads or recalculates `Commission.rateBps`/`amount` —
 * it only ever creates a refund-type `FinancialAdjustment` for the
 * disputed amount and, via `ReverseProfessionalPayoutUseCase`, reverses
 * an already-`PAID` Payout (which itself reverses the *persisted*
 * `Commission.amount`, never a live recalculation — see that use case's
 * own "Commission reversal" doc comment). The current platform commission
 * rate is never consulted anywhere in this file.
 */
export class ProcessStripeDisputeWebhookUseCase {
  private readonly disputes: StripeDisputeRepository;
  private readonly payments: PaymentRepository;
  private readonly payouts: PayoutRepository;
  private readonly financialAdjustments: FinancialAdjustmentRepository;
  private readonly createFinancialAdjustment: CreateFinancialAdjustmentUseCase;
  private readonly reversePayout: ReverseProfessionalPayoutUseCase;
  private readonly lock: DistributedLock;
  private readonly eventBus: EventBus;
  private readonly systemActorUserId: string | null;
  private readonly failureReporter: FailureReporter;

  constructor(deps: ProcessStripeDisputeWebhookDeps) {
    this.disputes = deps.disputes;
    this.payments = deps.payments;
    this.payouts = deps.payouts;
    this.financialAdjustments = deps.financialAdjustments;
    this.createFinancialAdjustment = deps.createFinancialAdjustment;
    this.reversePayout = deps.reversePayout;
    this.lock = deps.lock;
    this.eventBus = deps.eventBus;
    this.systemActorUserId = deps.systemActorUserId;
    this.failureReporter = deps.failureReporter ?? new NullFailureReporter();
  }

  async handleCreated(payload: StripeDisputeEventPayload): Promise<void> {
    const matchedPayment = payload.paymentIntentId
      ? await this.payments.findByStripePaymentIntentId(payload.paymentIntentId)
      : null;

    const { created, record } = await this.disputes.createIfNotExists({
      stripeDisputeId: payload.disputeId,
      stripeChargeId: payload.chargeId,
      stripePaymentIntentId: payload.paymentIntentId,
      paymentId: matchedPayment?.id ?? null,
      jobId: matchedPayment?.jobId ?? null,
      amount: payload.amount,
      currency: payload.currency,
      reason: payload.reason,
      status: mapOpenStatus(payload.status),
      evidenceDueBy: payload.evidenceDueBy,
    });

    if (!matchedPayment) {
      logger.warn("stripe_dispute_webhook.created_unmatched_payment", {
        stripeDisputeId: payload.disputeId,
        paymentIntentId: payload.paymentIntentId,
      });
    }

    // Only publish/log on genuine first-creation — see
    // `StripeDisputeRepository.createIfNotExists`'s own doc comment for
    // why `created` (not a timestamp comparison) is the correct signal.
    if (created) {
      await publishDomainEvent(
        this.eventBus,
        new StripeDisputeOpened(record.id, record.stripeDisputeId, record.paymentId, record.jobId, record.amount, record.currency, record.reason),
        this.failureReporter,
      );
      logger.info("stripe_dispute_webhook.opened", { stripeDisputeId: record.stripeDisputeId, paymentId: record.paymentId, jobId: record.jobId });
    }
  }

  async handleUpdated(payload: StripeDisputeEventPayload): Promise<void> {
    const existing = await this.disputes.findByStripeDisputeId(payload.disputeId);
    if (!existing) {
      // Out-of-order delivery — `updated` arrived before `created`. Treat
      // this as the dispute's own first sighting rather than dropping it
      // — never rely solely on in-memory/delivery-order assumptions (see
      // this module's own "webhook ordering" requirement).
      await this.handleCreated(payload);
      return;
    }

    await this.disputes.updateFromStripe(existing.id, {
      amount: payload.amount,
      reason: payload.reason,
      status: mapOpenStatus(payload.status),
      evidenceDueBy: payload.evidenceDueBy,
    });
  }

  async handleClosed(payload: StripeDisputeEventPayload): Promise<void> {
    const finalStatus = mapFinalStatus(payload.status);
    if (!finalStatus) {
      // Stripe's documented `closed` event always carries a terminal
      // status; an unrecognized one is unexpected but must never crash
      // webhook processing — acknowledge and flag for observability.
      logger.warn("stripe_dispute_webhook.closed_unrecognized_status", { stripeDisputeId: payload.disputeId, status: payload.status });
      return;
    }

    let existing = await this.disputes.findByStripeDisputeId(payload.disputeId);
    if (!existing) {
      // Out-of-order delivery — `closed` arrived before `created`/`updated`
      // ever did. Create the row now so it is never lost, matching
      // `handleUpdated`'s own out-of-order safety.
      const matchedPayment = payload.paymentIntentId
        ? await this.payments.findByStripePaymentIntentId(payload.paymentIntentId)
        : null;
      const upserted = await this.disputes.createIfNotExists({
        stripeDisputeId: payload.disputeId,
        stripeChargeId: payload.chargeId,
        stripePaymentIntentId: payload.paymentIntentId,
        paymentId: matchedPayment?.id ?? null,
        jobId: matchedPayment?.jobId ?? null,
        amount: payload.amount,
        currency: payload.currency,
        reason: payload.reason,
        status: "UNDER_REVIEW",
        evidenceDueBy: payload.evidenceDueBy,
      });
      existing = upserted.record;
    }

    if (existing.status === finalStatus || existing.financialAdjustmentId) {
      // Idempotent replay — already recorded this exact outcome (or a
      // LOST outcome that already produced its one FinancialAdjustment).
      // Never re-run any financial side effect.
      return;
    }
    if (existing.status === "WON" || existing.status === "LOST" || existing.status === "WARNING_CLOSED") {
      // Already terminal but with a DIFFERENT status than this delivery
      // claims — Stripe never re-opens or re-closes a dispute with a
      // different outcome; treat as a stale/conflicting redelivery and
      // never overwrite an already-recorded outcome.
      logger.warn("stripe_dispute_webhook.closed_conflicting_redelivery", {
        stripeDisputeId: payload.disputeId,
        recordedStatus: existing.status,
        deliveredStatus: finalStatus,
      });
      return;
    }

    if (finalStatus !== "LOST") {
      await this.disputes.markClosed({ id: existing.id, status: finalStatus, financialAdjustmentId: null });
      await this.publishClosed(existing, finalStatus, null);
      return;
    }

    // finalStatus === "LOST" — the one path that can move money.
    if (!existing.paymentId || !existing.jobId) {
      logger.warn("stripe_dispute_webhook.lost_unmatched_payment", { stripeDisputeId: payload.disputeId });
      await this.disputes.markClosed({ id: existing.id, status: "LOST", financialAdjustmentId: null });
      await this.publishClosed(existing, "LOST", null);
      return;
    }
    if (!this.systemActorUserId) {
      // Fail-safe, never fail-silent: the StripeDispute row and the fact
      // that it was LOST are still durably recorded (an admin/reconciliation
      // sweep can see it), but no FinancialAdjustment/payout reversal can
      // be attributed to anyone without a configured system actor — see
      // `env.STRIPE_DISPUTE_SYSTEM_USER_ID`'s own doc comment. Reported,
      // never thrown — this must still acknowledge the webhook (200).
      this.failureReporter.report(
        new Error(`Stripe dispute ${payload.disputeId} was LOST but STRIPE_DISPUTE_SYSTEM_USER_ID is not configured — no FinancialAdjustment could be created.`),
        { stripeDisputeId: payload.disputeId, paymentId: existing.paymentId, jobId: existing.jobId, note: "Requires manual admin review and configuration." },
      );
      return;
    }

    const jobId = existing.jobId;
    const paymentId = existing.paymentId;
    const systemActorUserId = this.systemActorUserId;

    const run = async (): Promise<void> => {
      const payment = await this.payments.findById(paymentId);
      if (!payment) {
        this.failureReporter.report(new Error(`Payment ${paymentId} referenced by StripeDispute ${existing!.id} no longer exists.`), {
          stripeDisputeId: payload.disputeId,
        });
        await this.disputes.markClosed({ id: existing!.id, status: "LOST", financialAdjustmentId: null });
        await this.publishClosed(existing!, "LOST", null);
        return;
      }
      if (payment.status !== "CAPTURED" && payment.status !== "PARTIALLY_REFUNDED") {
        // Nothing left to lose against this Payment (already fully
        // REFUNDED, or never reached CAPTURED) — record the closure with
        // no adjustment rather than attempting one Invariant 8 would
        // reject anyway.
        await this.disputes.markClosed({ id: existing!.id, status: "LOST", financialAdjustmentId: null });
        await this.publishClosed(existing!, "LOST", null);
        return;
      }

      const alreadyRefunded = await this.financialAdjustments.sumAppliedAmountForPayment(paymentId, REFUND_TYPE_ADJUSTMENTS);
      const decision = decideStripeDisputeFinancialOutcome({
        finalStatus: "LOST",
        disputeAmount: existing!.amount,
        paymentAmount: payment.amount,
        alreadyRefunded,
      });

      if (decision.outcome === "NO_FINANCIAL_ACTION" || decision.adjustments.length === 0) {
        await this.disputes.markClosed({ id: existing!.id, status: "LOST", financialAdjustmentId: null });
        await this.publishClosed(existing!, "LOST", null);
        return;
      }

      const adjustmentIntent = decision.adjustments[0]!;

      let adjustment;
      try {
        adjustment = await this.createFinancialAdjustment.execute(systemActorUserId, {
          jobId,
          disputeId: null,
          paymentId,
          type: adjustmentIntent.type,
          amount: adjustmentIntent.amount,
          reason: decision.reason,
          externalDisputeReference: existing!.stripeDisputeId,
        });
      } catch (error) {
        if (error instanceof ValidationError) {
          // Invariant 8 (or an equivalent guard) rejected this — the
          // Payment's own refund/adjustment history no longer supports
          // this amount (e.g. it was already fully refunded by another
          // path between this dispute opening and closing). Never
          // silently swallow this: report for manual reconciliation, but
          // still durably record the LOST outcome so it is never lost.
          this.failureReporter.report(error, { stripeDisputeId: payload.disputeId, paymentId, jobId, note: "Chargeback loss could not be recorded as a FinancialAdjustment — requires manual reconciliation." });
          await this.disputes.markClosed({ id: existing!.id, status: "LOST", financialAdjustmentId: null });
          await this.publishClosed(existing!, "LOST", null);
          return;
        }
        throw error;
      }

      await this.convergePaymentStatus(paymentId);

      // Post-adjustment payout recovery — mirrors `ExecuteRefundUseCase`'s
      // own "Case B" exactly: a PAID Payout for this Job means the
      // professional was already paid before this dispute was lost;
      // `ReverseProfessionalPayoutUseCase` claws it back. See that use
      // case's own doc comment — idempotent, reuses the persisted
      // Commission amount, never a live recalculation.
      const payout = await this.payouts.findByJobId(jobId);
      if (payout && payout.status === "PAID") {
        await this.reversePayout.execute({
          payoutId: payout.id,
          requestedByUserId: systemActorUserId,
          reason: `Stripe dispute ${existing!.stripeDisputeId} was lost — payout reversed to recover the chargeback amount.`,
        });
      }

      const closedRecord = await this.disputes.markClosed({ id: existing!.id, status: "LOST", financialAdjustmentId: adjustment.id });
      await this.publishClosed(closedRecord, "LOST", adjustment.id);

      logger.info("stripe_dispute_webhook.lost_settled", {
        stripeDisputeId: existing!.stripeDisputeId,
        paymentId,
        jobId,
        financialAdjustmentId: adjustment.id,
        amount: adjustmentIntent.amount,
      });
    };

    const result = await this.lock.withLock(payoutLockKey(jobId), LOCK_TTL_MS, run);
    if (result === null) {
      // A payout execution or refund is currently in-flight for this Job
      // — never proceed unsafely. The webhook route's non-2xx response
      // (via the thrown error below, mirroring `ExecuteRefundUseCase`'s
      // own posture) makes Stripe retry the delivery shortly, and this
      // method's own idempotency guards make that retry safe.
      throw new ValidationError(`A payout/refund operation is already in progress for job "${jobId}" — dispute settlement deferred, will retry.`);
    }
  }

  private async convergePaymentStatus(paymentId: string): Promise<void> {
    const current = await this.payments.findById(paymentId);
    if (!current) return;
    if (current.status === "REFUNDED") return;

    const refundedTotal = await this.financialAdjustments.sumAppliedAmountForPayment(paymentId, REFUND_TYPE_ADJUSTMENTS);
    const target: "REFUNDED" | "PARTIALLY_REFUNDED" = refundedTotal >= current.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";

    const { applied } = await this.payments.updateStatus({ id: paymentId, fromStatuses: [current.status], toStatus: target });
    if (!applied) {
      // Lost a compare-and-swap race — the money movement itself (the
      // FinancialAdjustment, already APPLIED) remains authoritative
      // either way; report for reconciliation rather than retrying
      // indefinitely, mirroring `ExecuteRefundUseCase.convergePaymentStatus`'s
      // own posture.
      this.failureReporter.report(new Error(`Payment ${paymentId} status could not be converged after a lost Stripe dispute.`), {
        paymentId,
        note: "Requires manual reconciliation.",
      });
    }
  }

  private async publishClosed(
    record: StripeDisputeRecord,
    outcome: "WON" | "LOST" | "WARNING_CLOSED",
    financialAdjustmentId: string | null,
  ): Promise<void> {
    await publishDomainEvent(
      this.eventBus,
      new StripeDisputeClosed(record.id, record.stripeDisputeId, record.paymentId, record.jobId, outcome, record.amount, record.currency, financialAdjustmentId),
      this.failureReporter,
    );
  }

  /** Dispatches by Stripe's own raw event type — the one method
   *  `ProcessCustomerPaymentWebhookUseCase` calls. */
  async handle(eventType: string, payload: StripeDisputeEventPayload): Promise<void> {
    switch (eventType) {
      case "charge.dispute.created":
        return this.handleCreated(payload);
      case "charge.dispute.updated":
        return this.handleUpdated(payload);
      case "charge.dispute.closed":
        return this.handleClosed(payload);
      default:
        return;
    }
  }
}
