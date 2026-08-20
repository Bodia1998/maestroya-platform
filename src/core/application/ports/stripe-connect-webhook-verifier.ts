/**
 * Module 72 — Stripe Webhooks.
 *
 * The single abstraction application/route code is allowed to depend on
 * for verifying and parsing an inbound Stripe Connect webhook delivery.
 * No Stripe SDK type (`Stripe.Event`, `Stripe.Account`, ...) appears here
 * or anywhere it's called from — the same "provider MUST NOT appear
 * anywhere in this module" rule `StripeConnectGateway`
 * (`application/ports/stripe-connect-gateway.ts`) and
 * `VerificationProvider` (`application/ports/verification-provider.ts`)
 * already establish, applied to webhook signature verification instead
 * of outbound API calls.
 *
 * `StripeConnectWebhookVerifierAdapter`
 * (`infrastructure/payments/stripe/stripe-connect-webhook-verifier.ts`)
 * is the one real implementation, wired from `infrastructure/payments/
 * stripe/compose.ts`. It is the only file in this module that imports the
 * Stripe SDK or calls `stripe.webhooks.constructEvent` — every other file
 * (the route, the use case) only ever sees the provider-agnostic shapes
 * below.
 */

/**
 * The subset of a Stripe `account.updated` event's `Account` payload this
 * platform reasons about — deliberately the same field set
 * `StripeAccountStatusResult` (`application/ports/stripe-connect-
 * gateway.ts`) already exposes for the polling path
 * (`GetStripeAccountStatusUseCase`), so `ProcessStripeConnectWebhookUseCase`
 * can feed both into the exact same domain rules
 * (`domain/services/stripe-connect-account-rules.ts`) without a second,
 * competing mapping.
 */
export interface StripeConnectAccountUpdatedPayload {
  stripeAccountId: string;
  detailsSubmitted: boolean;
  transfersActive: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue: string[];
  disabledReason: string | null;
}

/**
 * A verified Stripe Connect webhook event — signature already checked by
 * the time application code ever sees one of these. `accountUpdated` is
 * populated only for `type === "account.updated"`; every other
 * (validly-signed) event type this platform doesn't act on yet carries
 * `null` there so the use case can acknowledge it without processing.
 */
/**
 * Module 76 — Professional Payout Execution: the subset of a Stripe
 * `transfer.created` event's `Transfer` payload this platform reasons
 * about — populated only for `type === "transfer.created"`. Transfers
 * this module creates (`StripeTransferGatewayAdapter.createTransfer`)
 * always carry `metadata.payoutId`/`metadata.jobId`, written at creation
 * time specifically so this reconciliation path can correlate the event
 * back to the `Payout` row that requested it without trusting anything
 * else in the payload. A `transfer.created` event for a Transfer this
 * platform did NOT create (no recognizable metadata — should not occur in
 * practice, but never assumed) carries `payoutId: null`, which
 * `ProcessStripeConnectWebhookUseCase` treats as unmatched/ignored, never
 * as a reason to guess which Payout it might belong to.
 */
export interface StripeConnectTransferCreatedPayload {
  /** Stripe's own `Transfer.id` (`tr_...`). */
  stripeTransferId: string;
  /** `Transfer.destination` — the connected account id funds moved to.
   *  Diagnostic/correlation only; the webhook path never re-derives or
   *  re-validates the destination (that happened once, synchronously, in
   *  `ExecuteProfessionalPayoutUseCase`). */
  destinationStripeAccountId: string | null;
  /** `Transfer.metadata.payoutId`, as written by
   *  `StripeTransferGatewayAdapter.createTransfer` — `null` if absent
   *  (a Transfer this platform's own metadata convention doesn't
   *  recognize). */
  payoutId: string | null;
}

export interface StripeConnectWebhookEvent {
  /** Stripe's own `Event.id` — the idempotency key
   *  `ExternalWebhookEventRepository.claim` uses. */
  id: string;
  /** Stripe's own `Event.type` string, kept only for observability/
   *  routing — never itself trusted as a security decision beyond
   *  "was this signature valid" (already true by construction here). */
  type: string;
  /** Stripe's own `Event.created` (Unix seconds since epoch), converted
   *  to a `Date`. Used only to detect a webhook delivered out of order
   *  relative to Stripe state this platform has already synchronized
   *  (via an earlier webhook or an earlier poll) — see
   *  `ProcessStripeConnectWebhookUseCase`'s own doc comment. */
  createdAt: Date;
  accountUpdated: StripeConnectAccountUpdatedPayload | null;
  /** Module 76 — Professional Payout Execution: populated only for
   *  `type === "transfer.created"` — see
   *  `StripeConnectTransferCreatedPayload`'s own doc comment. `null` for
   *  every other event type, including `account.updated`. */
  transferCreated: StripeConnectTransferCreatedPayload | null;
}

export type StripeConnectWebhookValidationResult =
  | { valid: true; event: StripeConnectWebhookEvent }
  | { valid: false };

export interface StripeConnectWebhookVerifier {
  /**
   * Verifies the Stripe signature on a raw (unparsed) request body and,
   * only if valid, parses it into the provider-agnostic
   * `StripeConnectWebhookEvent` shape above. Never throws for a bad
   * signature or malformed payload — both are reported as
   * `{ valid: false }` so the caller can fail closed with a 4xx without
   * a try/catch of its own (matches `VerificationProvider
   * .webhookValidation`'s own "never throws" convention).
   */
  verify(rawBody: string, signatureHeader: string | null): StripeConnectWebhookValidationResult;
}
