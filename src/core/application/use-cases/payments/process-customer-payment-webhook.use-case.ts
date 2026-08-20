import { Payment } from "@/domain/entities/payment";
import { InvalidPaymentTransitionError } from "@/domain/errors/domain-error";
import type { EventBus } from "@/application/ports/event-bus";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import { NullFailureReporter } from "@/application/ports/failure-reporter";
import type { PaymentGateway } from "@/application/ports/payment-gateway";
import type { StripePaymentWebhookEvent } from "@/application/ports/stripe-payment-webhook-verifier";
import type { ExternalWebhookEventRepository } from "@/domain/repositories/external-webhook-event-repository";
import type { PaymentRecord, PaymentRepository } from "@/domain/repositories/payment-repository";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { logger } from "@/infrastructure/observability/logger";

/** Module 73 — Real Customer Payment Capture: the provider key this module
 *  claims webhook events under — distinct from Module 72's `"STRIPE"`
 *  (used for Connect account events) even though both ultimately come from
 *  Stripe, because `(provider, externalEventId)` is the uniqueness
 *  invariant `ExternalWebhookEventRepository.claim` enforces, and this
 *  module's events arrive on a *separate* webhook endpoint/secret (see
 *  `StripePaymentWebhookVerifier`'s own doc comment) — keeping the
 *  provider key distinct keeps the two event streams' idempotency ledgers
 *  independently inspectable, never coincidentally colliding. */
export const STRIPE_PAYMENTS_WEBHOOK_PROVIDER = "STRIPE_PAYMENTS";

export type ProcessCustomerPaymentWebhookOutcome =
  | "captured"
  | "failed"
  | "cancelled"
  | "refund-observed"
  | "duplicate"
  | "ignored"
  | "unmatched"
  | "already-settled";

export interface ProcessCustomerPaymentWebhookResult {
  outcome: ProcessCustomerPaymentWebhookOutcome;
  paymentId?: string;
}

/**
 * Module 73 — Real Customer Payment Capture.
 *
 * The application-layer use case `/api/webhooks/stripe-payments/route.ts`
 * delegates to, once the Route Handler has already verified the inbound
 * request's signature via `StripePaymentWebhookVerifier` — mirrors
 * `ProcessStripeConnectWebhookUseCase`'s (Module 72) own division of
 * responsibility exactly: this class is never itself given a raw body or
 * signature header, only the already-verified `StripePaymentWebhookEvent`.
 *
 * ## Why webhook-driven, not a client-confirmed endpoint
 * The module brief asks this to be decided deliberately, not assumed: this
 * design drives every state transition from Stripe's own webhook
 * deliveries, never from a "the client told us payment succeeded" endpoint
 * — the client only ever needs the `client_secret`
 * `InitiateQuotePaymentUseCase` returns to complete card confirmation via
 * Stripe.js directly against Stripe. That makes the whole flow robust to
 * exactly the failure modes the module brief calls out (browser refresh,
 * network retry, the tab being closed mid-confirmation) — nothing
 * server-side depends on the browser successfully reporting back.
 *
 * ## Manual-capture event flow (why `amount_capturable_updated` is handled)
 * With `capture_method: "manual"`, Stripe's documented event sequence for
 * a successful payment is `payment_intent.amount_capturable_updated`
 * (authorization succeeded, funds reserved, `requires_capture`) — the
 * exact moment this platform must call `PaymentGateway.capture` — followed
 * by `payment_intent.succeeded` only once that capture call has actually
 * happened. This handler therefore performs the capture itself in
 * response to `amount_capturable_updated`, and treats `succeeded` as an
 * idempotent confirmation/backstop (already-CAPTURED is a no-op; see
 * `handlePaymentIntentSucceeded`) rather than the trigger — a manual-
 * capture PaymentIntent could otherwise never reach `CAPTURED` via webhook
 * alone, since Stripe never emits `succeeded` for one until *something*
 * has already captured it.
 *
 * ## `charge.refunded` — observability only
 * Deliberately never mutates a Payment's status or `refundedAmount` here —
 * that decision belongs to Module 77 (Refund & Dispute Financial
 * Execution), which owns the actual refund-eligibility policy. This
 * handler logs the event (so a refund initiated directly in the Stripe
 * Dashboard, or a chargeback, is at least observable today) and
 * acknowledges it, nothing more.
 *
 * ## Idempotency / concurrency
 * `ExternalWebhookEventRepository.claim()` guards duplicate *delivery* of
 * the same Stripe event id, exactly like Module 72. Independently,
 * `PaymentRepository.updateStatus`'s compare-and-swap `fromStatuses` guard
 * (see that method's own doc comment) protects against a *different* kind
 * of duplication this module uniquely needs to guard against: two
 * different Stripe event types (or two redeliveries of different events)
 * both trying to apply a capture around the same time — only the delivery
 * whose `UPDATE ... WHERE status IN (...)` actually matches ever proceeds
 * to call `PaymentGateway.capture`/publish `PaymentCaptured`.
 */
export class ProcessCustomerPaymentWebhookUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly webhookEvents: ExternalWebhookEventRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(event: StripePaymentWebhookEvent): Promise<ProcessCustomerPaymentWebhookResult> {
    const claim = await this.webhookEvents.claim({
      provider: STRIPE_PAYMENTS_WEBHOOK_PROVIDER,
      externalEventId: event.id,
      eventType: event.type,
    });

    if (!claim.claimed) {
      return { outcome: "duplicate" };
    }

    try {
      const result = await this.process(event);
      await this.webhookEvents.markProcessed(claim.record.id);
      return result;
    } catch (error) {
      // Same contract as Module 72's ProcessStripeConnectWebhookUseCase:
      // the claim stays re-claimable by Stripe's own retry; the route
      // handler's non-2xx response is what actually triggers that retry.
      await this.webhookEvents.markFailed(claim.record.id);
      throw error;
    }
  }

  private async process(event: StripePaymentWebhookEvent): Promise<ProcessCustomerPaymentWebhookResult> {
    switch (event.type) {
      case "payment_intent.amount_capturable_updated":
        return this.handleAuthorizationSucceeded(event);
      case "payment_intent.succeeded":
        return this.handlePaymentIntentSucceeded(event);
      case "payment_intent.payment_failed":
        return this.handlePaymentFailed(event);
      case "payment_intent.canceled":
        return this.handleCanceled(event);
      case "charge.refunded":
        return this.handleChargeRefunded(event);
      default:
        return { outcome: "ignored" };
    }
  }

  private async handleAuthorizationSucceeded(
    event: StripePaymentWebhookEvent,
  ): Promise<ProcessCustomerPaymentWebhookResult> {
    const payment = await this.findPayment(event);
    if (!payment) return { outcome: "unmatched" };

    if (payment.status !== "PENDING") {
      // Already progressed past PENDING — a duplicate/out-of-order
      // delivery, or `payment_intent.succeeded` already handled this.
      // Never re-capture.
      return { outcome: payment.status === "CAPTURED" ? "already-settled" : "ignored", paymentId: payment.id };
    }

    // Stripe has already told us the authorization succeeded — this call
    // is the one and only place this module ever moves money into the
    // platform's available balance. See this class's own doc comment on
    // why capture happens here rather than being deferred further.
    // `event.paymentIntent` is guaranteed non-null here — `findPayment`
    // only ever returns a match when it was present.
    await this.paymentGateway.capture(event.paymentIntent!.paymentIntentId);

    return this.markCaptured(payment);
  }

  private async handlePaymentIntentSucceeded(
    event: StripePaymentWebhookEvent,
  ): Promise<ProcessCustomerPaymentWebhookResult> {
    const payment = await this.findPayment(event);
    if (!payment) return { outcome: "unmatched" };

    if (payment.status === "CAPTURED") {
      return { outcome: "already-settled", paymentId: payment.id };
    }
    if (payment.status !== "PENDING" && payment.status !== "AUTHORIZED") {
      // A terminal status (FAILED/CANCELLED/...) receiving a late
      // `succeeded` delivery is unexpected but must never crash webhook
      // processing — acknowledge and move on, flagged for observability.
      logger.warn("stripe_payments_webhook.succeeded_after_terminal_status", {
        paymentId: payment.id,
        status: payment.status,
      });
      return { outcome: "ignored", paymentId: payment.id };
    }

    // Backstop path — see this class's own doc comment on why `succeeded`
    // is a confirmation, not the primary capture trigger. Funds are
    // already captured on Stripe's side by definition of this event
    // existing; no second `gateway.capture()` call is made here.
    return this.markCaptured(payment);
  }

  private async markCaptured(payment: PaymentRecord): Promise<ProcessCustomerPaymentWebhookResult> {
    const domainPayment = Payment.reconstitute(
      {
        serviceRequestId: payment.serviceRequestId,
        payerId: payment.payerId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        refundedAmount: 0,
        failureReason: payment.failureReason,
        capturedAt: payment.capturedAt,
      },
      payment.id,
    );

    try {
      if (payment.status === "PENDING") domainPayment.authorize();
      domainPayment.capture();
    } catch (error) {
      if (error instanceof InvalidPaymentTransitionError) {
        // Lost an in-memory race against this same process/another
        // instance between the `findPayment` read above and here — the
        // database compare-and-swap below is the real guard; this is just
        // defense in depth against acting on stale in-memory state.
        return { outcome: "already-settled", paymentId: payment.id };
      }
      throw error;
    }

    const { applied, record } = await this.payments.updateStatus({
      id: payment.id,
      fromStatuses: ["PENDING", "AUTHORIZED"],
      toStatus: "CAPTURED",
      capturedAt: domainPayment.capturedAt,
      failureReason: null,
    });

    if (!applied) {
      // Someone else's delivery won the compare-and-swap first — their
      // handler already published PaymentCaptured; publishing it again
      // here would double-fire commission recording.
      return { outcome: "already-settled", paymentId: record.id };
    }

    for (const domainEvent of domainPayment.pullDomainEvents()) {
      await publishDomainEvent(this.eventBus, domainEvent, this.failureReporter);
    }

    logger.info("stripe_payments_webhook.payment_captured", { paymentId: record.id });
    return { outcome: "captured", paymentId: record.id };
  }

  private async handlePaymentFailed(event: StripePaymentWebhookEvent): Promise<ProcessCustomerPaymentWebhookResult> {
    const payment = await this.findPayment(event);
    if (!payment) return { outcome: "unmatched" };

    if (payment.status !== "PENDING" && payment.status !== "AUTHORIZED") {
      return { outcome: "already-settled", paymentId: payment.id };
    }

    const { applied, record } = await this.payments.updateStatus({
      id: payment.id,
      fromStatuses: ["PENDING", "AUTHORIZED"],
      toStatus: "FAILED",
      failureReason: event.paymentIntent?.lastPaymentErrorMessage ?? "Payment authorization failed.",
    });

    if (!applied) return { outcome: "already-settled", paymentId: record.id };

    logger.info("stripe_payments_webhook.payment_failed", { paymentId: record.id });
    return { outcome: "failed", paymentId: record.id };
  }

  private async handleCanceled(event: StripePaymentWebhookEvent): Promise<ProcessCustomerPaymentWebhookResult> {
    const payment = await this.findPayment(event);
    if (!payment) return { outcome: "unmatched" };

    if (payment.status !== "PENDING" && payment.status !== "AUTHORIZED") {
      return { outcome: "already-settled", paymentId: payment.id };
    }

    const { applied, record } = await this.payments.updateStatus({
      id: payment.id,
      fromStatuses: ["PENDING", "AUTHORIZED"],
      toStatus: "CANCELLED",
    });

    if (!applied) return { outcome: "already-settled", paymentId: record.id };

    logger.info("stripe_payments_webhook.payment_cancelled", { paymentId: record.id });
    return { outcome: "cancelled", paymentId: record.id };
  }

  private async handleChargeRefunded(event: StripePaymentWebhookEvent): Promise<ProcessCustomerPaymentWebhookResult> {
    // Deliberately no state mutation — see this class's own doc comment.
    logger.info("stripe_payments_webhook.charge_refunded_observed", {
      chargeId: event.chargeRefunded?.chargeId,
      paymentIntentId: event.chargeRefunded?.paymentIntentId,
      amountRefunded: event.chargeRefunded?.amountRefunded,
    });
    return { outcome: "refund-observed" };
  }

  private async findPayment(event: StripePaymentWebhookEvent): Promise<PaymentRecord | null> {
    const paymentIntentId = event.paymentIntent?.paymentIntentId;
    if (!paymentIntentId) return null;
    return this.payments.findByStripePaymentIntentId(paymentIntentId);
  }
}
