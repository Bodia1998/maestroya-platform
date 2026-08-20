import "server-only";

import type Stripe from "stripe";

import type {
  StripeConnectAccountUpdatedPayload,
  StripeConnectTransferCreatedPayload,
  StripeConnectWebhookValidationResult,
  StripeConnectWebhookVerifier,
} from "@/application/ports/stripe-connect-webhook-verifier";

/**
 * Module 72 — Stripe Webhooks.
 *
 * `StripeConnectWebhookVerifier` implementation backed by the Stripe
 * SDK's `stripe.webhooks.constructEvent` — the one file in this module
 * that imports the Stripe SDK or knows about `Stripe.Event`/
 * `Stripe.Account`'s shape, mirroring `StripeConnectGatewayAdapter`'s own
 * "only file that imports the Stripe SDK" convention for the outbound
 * direction (`infrastructure/payments/stripe/stripe-connect-gateway.ts`).
 *
 * ## Signature verification
 * `constructEvent` both verifies the `Stripe-Signature` header (HMAC over
 * the *exact* raw request body, per https://docs.stripe.com/webhooks#verify-events)
 * and parses the JSON body, in one call — this platform never parses the
 * body first (which would make the byte-for-byte signature check
 * meaningless) and never trusts `event.type`/`event.data.object` before
 * this call has already succeeded. `constructEvent` throws
 * `Stripe.errors.StripeSignatureVerificationError` for a bad/missing
 * signature and a plain `SyntaxError` for a body that isn't valid JSON at
 * all — both are caught here and reported as `{ valid: false }`, never
 * rethrown, so this class never itself decides the HTTP response (that's
 * the route's job, same division of responsibility
 * `PersonaVerificationProvider.webhookValidation` already establishes).
 *
 * ## Connected-account identification
 * Per Stripe's own Connect webhooks documentation
 * (https://docs.stripe.com/connect/webhooks — "Each event for a
 * connected account contains a top-level `account` property that
 * identifies the connected account"), `event.account` is Stripe's
 * documented mechanism for this, valid across every Connect event type —
 * NOT `event.data.object.id`, which is a different resource (a `Person`,
 * an `ExternalAccount`, ...) for most event types. For `account.updated`
 * specifically, `data.object` happens to already be the `Account` itself
 * (so `data.object.id` and `event.account` coincide), but this adapter
 * still reads `event.account` first and falls back to `data.object.id`
 * only for that one event type — see `extractAccountUpdated` — rather
 * than assuming the coincidence generalizes to any other event this
 * module might add later.
 *
 * ## Never leaks the webhook secret or full payload
 * `env.STRIPE_WEBHOOK_SECRET` (already validated/required by
 * `infrastructure/config/env.ts`) never appears in a thrown error or a
 * log line here — `constructEvent`'s own thrown errors never include the
 * secret. This class also never logs the raw request body or the full
 * parsed `Stripe.Event` — callers only ever receive the narrow
 * `StripeConnectWebhookEvent` DTO.
 */
export class StripeConnectWebhookVerifierAdapter implements StripeConnectWebhookVerifier {
  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  verify(rawBody: string, signatureHeader: string | null): StripeConnectWebhookValidationResult {
    if (!signatureHeader) return { valid: false };

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch {
      // Deliberately swallows the specific reason (bad signature, stale
      // timestamp, malformed JSON, wrong secret) — same "never help an
      // attacker narrow down what's wrong with a forged request"
      // reasoning `PersonaVerificationProvider.webhookValidation`'s own
      // doc comment gives; the real reason, if any, belongs in a
      // server-side log at the call site, never in what's returned here.
      return { valid: false };
    }

    return {
      valid: true,
      event: {
        id: event.id,
        type: event.type,
        createdAt: new Date(event.created * 1000),
        accountUpdated: extractAccountUpdated(event),
        transferCreated: extractTransferCreated(event),
      },
    };
  }
}

/**
 * Maps a verified `account.updated` event onto the same field set
 * `StripeConnectGatewayAdapter.retrieveAccountStatus` already builds for
 * the polling path (`application/ports/stripe-connect-gateway.ts`'s
 * `StripeAccountStatusResult`) — deliberately identical mapping logic (see
 * that adapter's own "post-audit correction" comment on why
 * `charges_enabled` is never read) so a webhook-driven sync and a
 * poll-driven sync can never disagree about what a given `Account`
 * payload means. Returns `null` for any other event type — this module's
 * use case treats that as "acknowledge, nothing to synchronize."
 */
function extractAccountUpdated(event: Stripe.Event): StripeConnectAccountUpdatedPayload | null {
  if (event.type !== "account.updated") return null;

  const account = event.data.object as Stripe.Account;
  // `event.account` is Stripe's documented field for the connected
  // account id on every Connect event; for `account.updated` the event's
  // own resource (`data.object`) is the `Account` itself, so `account.id`
  // is the same value and used only as a fallback should `event.account`
  // ever be absent (defense in depth — never assumed for any other event
  // type, see this file's own doc comment).
  const stripeAccountId = event.account ?? account.id;
  if (!stripeAccountId) return null;

  return {
    stripeAccountId,
    detailsSubmitted: Boolean(account.details_submitted),
    transfersActive: account.capabilities?.transfers === "active",
    payoutsEnabled: Boolean(account.payouts_enabled),
    requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

/**
 * Module 76 — Professional Payout Execution: maps a verified
 * `transfer.created` event onto `StripeConnectTransferCreatedPayload` —
 * see that type's own doc comment. `metadata.payoutId`/`metadata.jobId`
 * are exactly what `StripeTransferGatewayAdapter.createTransfer`
 * (Module 76) writes onto every Transfer it creates; a Transfer without
 * that metadata (should never occur for a Transfer this platform itself
 * created) safely yields `payoutId: null` rather than throwing. Returns
 * `null` for any other event type, mirroring `extractAccountUpdated`'s own
 * convention exactly.
 */
function extractTransferCreated(event: Stripe.Event): StripeConnectTransferCreatedPayload | null {
  if (event.type !== "transfer.created") return null;

  const transfer = event.data.object as Stripe.Transfer;
  const destination = transfer.destination;
  const destinationStripeAccountId = typeof destination === "string" ? destination : (destination?.id ?? null);

  return {
    stripeTransferId: transfer.id,
    destinationStripeAccountId,
    payoutId: typeof transfer.metadata?.payoutId === "string" ? transfer.metadata.payoutId : null,
  };
}
