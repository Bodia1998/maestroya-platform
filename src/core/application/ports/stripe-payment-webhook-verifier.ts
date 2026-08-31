/**
 * Module 73 — Real Customer Payment Capture.
 *
 * The customer-payment counterpart to `StripeConnectWebhookVerifier`
 * (`application/ports/stripe-connect-webhook-verifier.ts`, Module 72) —
 * deliberately a separate port, not a reused/extended one, mirroring this
 * codebase's existing "one route per provider/concern" convention (see
 * that port's own doc comment): Connect webhooks arrive on a Stripe
 * endpoint configured for "Events from: Connected accounts," while the
 * PaymentIntent/Charge events this port verifies arrive on a *platform*
 * Stripe webhook endpoint (no `connect: true`) — two different signing
 * secrets, two different event scopes, and (per the module brief's
 * explicit instruction not to blindly expand the Module 72 handler) two
 * different Route Handlers.
 *
 * No Stripe SDK type appears here or anywhere it's called from — the same
 * "provider MUST NOT appear anywhere in this module" rule `PaymentGateway`/
 * `StripeConnectWebhookVerifier` already establish.
 */
export interface StripePaymentIntentEventPayload {
  /** Stripe's own PaymentIntent id (`pi_...`) — the only field this
   *  module's use case needs to correlate the event back to a persisted
   *  `Payment` row (via `PaymentRepository.findByStripePaymentIntentId`).
   *  Never any other PaymentIntent field — status, amount, and every other
   *  detail are always re-read from this platform's own persisted Payment/
   *  Quote, never trusted from the webhook payload itself (see
   *  `ProcessCustomerPaymentWebhookUseCase`'s own doc comment on "the
   *  webhook must never trust client-side state," which extends to never
   *  trusting the *provider's* payload for anything beyond "which charge
   *  is this about"). */
  paymentIntentId: string;
  /** Stripe's own decline/failure message, present only on
   *  `payment_intent.payment_failed` — surfaced (never any other PII/card
   *  data) as `Payment.failureReason`. `null` for every other event type. */
  lastPaymentErrorMessage: string | null;
}

/**
 * Module 73's `charge.refunded` handling is deliberately observability-only
 * (see `ProcessCustomerPaymentWebhookUseCase`'s own doc comment on why —
 * real refund execution is Module 77's job) — this payload carries just
 * enough to log/correlate the event, never enough to imply a refund
 * business decision was made here.
 */
export interface StripeChargeRefundedPayload {
  chargeId: string;
  paymentIntentId: string | null;
  /** Stripe's own `amount_refunded`, already converted from minor units —
   *  logged only, never itself written to any Payment/ledger row (see
   *  this module's own doc comment — the *amount* this platform records
   *  always comes from its own already-persisted `Refund` row, never from
   *  a webhook payload). */
  amountRefunded: number;
  /** Module 77 — Refund & Dispute Financial Execution: the most recent
   *  Stripe `Refund.id` on this Charge (`charge.refunds.data[0].id`) —
   *  `null` if the Charge somehow carries no refund object (unexpected for
   *  a `charge.refunded` event, defensively optional). Used only to
   *  *reconcile* this platform's own `Refund` row (found by
   *  `RefundRepository.findByStripeRefundId`) — never to create or mutate
   *  a Refund's amount from webhook data alone; see
   *  `ProcessCustomerPaymentWebhookUseCase.handleChargeRefunded`'s own doc
   *  comment. */
  refundId?: string | null;
  /** Module 77: that same latest refund's own Stripe status
   *  (`"succeeded" | "pending" | "failed" | "canceled"`), logged/
   *  reconciled only. */
  status?: string | null;
}

/**
 * Module 86 — Stripe Chargeback & Dispute Handling: Stripe's own
 * `Dispute` object fields this platform actually needs — populated for
 * `charge.dispute.created`/`charge.dispute.updated`/`charge.dispute.closed`,
 * `null` for every other event type. `status` carries Stripe's own raw
 * dispute status string (`"needs_response"`, `"under_review"`, `"won"`,
 * `"lost"`, `"warning_closed"`, ...) — never interpreted here (see
 * `StripePaymentWebhookVerifier`'s own "provider MUST NOT appear anywhere
 * [downstream]" rule); `ProcessStripeDisputeWebhookUseCase` is the one
 * place that maps this raw string onto this platform's own
 * `StripeDisputeStatusValue`.
 */
export interface StripeDisputeEventPayload {
  /** Stripe's own `Dispute.id` (`dp_...`). */
  disputeId: string;
  chargeId: string;
  paymentIntentId: string | null;
  /** Already converted from minor units. */
  amount: number;
  currency: string;
  /** Stripe's own dispute reason string — observability only. */
  reason: string | null;
  /** Stripe's own raw `Dispute.status` string — see this interface's own
   *  doc comment. */
  status: string;
  /** Stripe's own `evidence_details.due_by` (already converted from a
   *  Unix timestamp), if present. */
  evidenceDueBy: Date | null;
}

export interface StripePaymentWebhookEvent {
  id: string;
  type: string;
  createdAt: Date;
  /** Populated for every `payment_intent.*` event type this port
   *  recognizes (`amount_capturable_updated`, `succeeded`,
   *  `payment_failed`, `canceled`) — `null` for every other event type,
   *  including `charge.refunded`. */
  paymentIntent: StripePaymentIntentEventPayload | null;
  /** Populated only for `charge.refunded` — `null` otherwise. */
  chargeRefunded: StripeChargeRefundedPayload | null;
  /** Module 86: populated only for `charge.dispute.created`/
   *  `charge.dispute.updated`/`charge.dispute.closed` — `null` otherwise. */
  dispute: StripeDisputeEventPayload | null;
}

export type StripePaymentWebhookValidationResult =
  | { valid: true; event: StripePaymentWebhookEvent }
  | { valid: false };

export interface StripePaymentWebhookVerifier {
  /** Verifies `rawBody`'s `Stripe-Signature` header against the
   *  *payments* webhook secret and, only on success, parses and extracts
   *  the narrow `StripePaymentWebhookEvent` shape above — see
   *  `StripeConnectWebhookVerifier.verify`'s own doc comment for the full
   *  "never parse before verifying" contract, identical here. */
  verify(rawBody: string, signatureHeader: string | null): StripePaymentWebhookValidationResult;
}
