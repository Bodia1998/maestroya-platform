import "server-only";

import type Stripe from "stripe";

import type {
  StripeChargeRefundedPayload,
  StripeDisputeEventPayload,
  StripePaymentIntentEventPayload,
  StripePaymentWebhookValidationResult,
  StripePaymentWebhookVerifier,
} from "@/application/ports/stripe-payment-webhook-verifier";

const HANDLED_PAYMENT_INTENT_EVENTS = new Set([
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
]);

// Module 86 — Stripe Chargeback & Dispute Handling: the three
// `charge.dispute.*` events this platform's business lifecycle actually
// needs (see MODULE_86_IMPLEMENTATION_REPORT.md, "Which dispute webhook
// events are necessary"). `charge.dispute.funds_withdrawn`/
// `charge.dispute.funds_reinstated` are deliberately NOT handled — they
// mirror information `charge.dispute.created`/`charge.dispute.closed`
// already carry (the withdrawal/reinstatement is a direct, deterministic
// consequence of a dispute opening/resolving, never an independent
// business decision) and adding them would only duplicate, never change,
// this platform's own financial outcome.
const HANDLED_DISPUTE_EVENTS = new Set(["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]);

/**
 * Module 73 — Real Customer Payment Capture.
 *
 * `StripePaymentWebhookVerifier` implementation, mirroring
 * `StripeConnectWebhookVerifierAdapter`'s own verification contract
 * exactly (`infrastructure/payments/stripe/stripe-connect-webhook-verifier.ts`,
 * Module 72) — `constructEvent` verifies the raw body against the
 * *payments* webhook secret and parses it in one call, a bad/missing
 * signature or malformed body is swallowed and reported as
 * `{ valid: false }` (never the specific reason, never rethrown — same
 * "don't help an attacker narrow down what's wrong with a forged request"
 * posture), and neither the webhook secret nor the raw body/full event is
 * ever logged by this class.
 */
export class StripePaymentWebhookVerifierAdapter implements StripePaymentWebhookVerifier {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  verify(rawBody: string, signatureHeader: string | null): StripePaymentWebhookValidationResult {
    if (!signatureHeader) return { valid: false };

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch {
      return { valid: false };
    }

    return {
      valid: true,
      event: {
        id: event.id,
        type: event.type,
        createdAt: new Date(event.created * 1000),
        paymentIntent: extractPaymentIntent(event),
        chargeRefunded: extractChargeRefunded(event),
        dispute: extractDispute(event),
      },
    };
  }
}

function extractPaymentIntent(event: Stripe.Event): StripePaymentIntentEventPayload | null {
  if (!HANDLED_PAYMENT_INTENT_EVENTS.has(event.type)) return null;

  const intent = event.data.object as Stripe.PaymentIntent;
  return {
    paymentIntentId: intent.id,
    lastPaymentErrorMessage: intent.last_payment_error?.message ?? null,
  };
}

function extractChargeRefunded(event: Stripe.Event): StripeChargeRefundedPayload | null {
  if (event.type !== "charge.refunded") return null;

  const charge = event.data.object as Stripe.Charge;
  const latestRefund = charge.refunds?.data?.[0] ?? null;
  return {
    chargeId: charge.id,
    paymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null),
    amountRefunded: charge.amount_refunded / 100,
    refundId: latestRefund?.id ?? null,
    status: latestRefund?.status ?? null,
  };
}

/** Module 86 — Stripe Chargeback & Dispute Handling. See
 *  `StripeDisputeEventPayload`'s own doc comment — `status` is passed
 *  through verbatim as Stripe's own raw string, never interpreted here. */
function extractDispute(event: Stripe.Event): StripeDisputeEventPayload | null {
  if (!HANDLED_DISPUTE_EVENTS.has(event.type)) return null;

  const dispute = event.data.object as Stripe.Dispute;
  return {
    disputeId: dispute.id,
    chargeId: typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id,
    paymentIntentId:
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null),
    amount: dispute.amount / 100,
    currency: dispute.currency,
    reason: dispute.reason ?? null,
    status: dispute.status,
    evidenceDueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
  };
}
