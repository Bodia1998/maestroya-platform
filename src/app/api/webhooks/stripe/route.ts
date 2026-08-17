import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getStripeConnectWebhookVerifierInstance,
  makeProcessStripeConnectWebhookUseCase,
} from "@/application/use-cases/stripe-connect/compose";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 72 — Stripe Webhooks: the Stripe Connect webhook delivery
 * endpoint — Connect's counterpart to `/api/webhooks/persona`
 * (`src/app/api/webhooks/persona/route.ts`), matching that route's own
 * "thin Route Handler" shape and the candidate path this codebase's own
 * multi-instance-safety idempotency checker already expects
 * (`infrastructure/multi-instance-safety/checkers/idempotency-checker.ts`
 * — `src/app/api/webhooks/stripe/route.ts` is the first of that
 * checker's recognized Stripe webhook route candidates).
 *
 * Configure this exact URL (`<platform base URL>/api/webhooks/stripe`) as
 * a webhook endpoint in the Stripe Dashboard with **Events from:
 * "Connected accounts"** (or `connect: true` via the API) — see this
 * module's own implementation report for the full Stripe Dashboard/CLI
 * setup instructions. This route only ever processes Connect-scoped
 * events (an `account.updated` for a connected account); it is
 * deliberately not shared with any future platform-scoped ("your
 * account") Stripe webhook endpoint, matching this codebase's existing
 * "one route per provider/concern" convention rather than branching one
 * handler on event scope.
 *
 * Thin Route Handler, per this module's own architectural rule:
 *   HTTP -> raw body -> signature verification
 *        (`StripeConnectWebhookVerifier` — Module 72's counterpart to
 *        `VerificationProvider.webhookValidation`)
 *        -> event/idempotency handling + application use case
 *           (`ProcessStripeConnectWebhookUseCase`)
 *        -> HTTP response
 * No business logic, no Stripe-specific parsing, and no signature
 * verification logic lives in this file — every one of those already
 * exists in `StripeConnectWebhookVerifierAdapter`/
 * `ProcessStripeConnectWebhookUseCase` and is only ever called from here,
 * never re-implemented. The Stripe SDK itself is never imported in this
 * file.
 *
 * ## Fail-closed checklist (see this module's own security requirements)
 * - The raw body is read once, as text, and handed to the verifier
 *   before anything in it is ever parsed or trusted for a business
 *   decision — Stripe's signature is an HMAC over the *exact* raw bytes,
 *   so JSON-parsing (or otherwise mutating) the body first would make
 *   the signature check meaningless. `ProcessStripeConnectWebhookUseCase`
 *   only ever receives the already-verified, already-parsed
 *   `StripeConnectWebhookEvent` fields the verifier extracted — never
 *   the raw body itself.
 * - Missing/invalid `stripe-signature` header, or a body that fails
 *   `stripe.webhooks.constructEvent`'s own signature/timestamp check ->
 *   `verify` returns `{ valid: false }` -> 401. Never processed.
 * - A malformed body that still carries a genuinely valid signature
 *   cannot occur here — `constructEvent` verifies and parses in one call,
 *   so a valid signature implies valid JSON by construction (unlike
 *   Persona's separate HMAC-then-JSON-parse flow).
 *
 * ## Idempotency / duplicate delivery
 * `ProcessStripeConnectWebhookUseCase` claims `(STRIPE, event.id)` via
 * `ExternalWebhookEventRepository` before doing anything else — a
 * duplicate delivery (Stripe's own retry, or two concurrent deliveries)
 * is acknowledged (200) with zero re-processing. See that use case's own
 * doc comment.
 *
 * ## Never logs sensitive data
 * Only the request id, outcome, and (once verified) the non-sensitive
 * `event.id`/`event.type`/connected Stripe account id are ever logged —
 * never the raw webhook body, the `Stripe-Signature` header, or
 * `STRIPE_WEBHOOK_SECRET`.
 */
export const POST = withApiTracing("/api/webhooks/stripe", async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };
  const route = "/api/webhooks/stripe";

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    logger.warn("stripe_connect_webhook_unreadable_body", { requestId, route });
    return NextResponse.json({ error: "Unable to read request body." }, { status: 400, headers });
  }

  const signatureHeader = request.headers.get("stripe-signature");

  const verifier = getStripeConnectWebhookVerifierInstance();
  const validation = verifier.verify(rawBody, signatureHeader);

  if (!validation.valid) {
    // Deliberately generic — never distinguishes "no secret configured"
    // from "bad signature" from "stale timestamp" from "malformed body"
    // in the response, which would help an attacker narrow down what's
    // wrong with a forged request. Nothing more specific is available to
    // log server-side either: `StripeConnectWebhookVerifier.verify`
    // intentionally never surfaces the underlying `constructEvent`
    // failure reason (see that adapter's own doc comment).
    logger.warn("stripe_connect_webhook_signature_invalid", { requestId, route });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401, headers });
  }

  try {
    const result = await makeProcessStripeConnectWebhookUseCase().execute(validation.event);

    logger.info("stripe_connect_webhook_processed", {
      requestId,
      route,
      outcome: result.outcome,
      eventId: validation.event.id,
      eventType: validation.event.type,
      stripeAccountId: validation.event.accountUpdated?.stripeAccountId,
    });

    return NextResponse.json(
      { status: result.outcome, requestId },
      // Every outcome here — processed, a legitimately duplicate
      // delivery, an event type this platform doesn't act on, an account
      // id this platform never issued, or a stale/out-of-order delivery
      // — is something Stripe must never retry, so every one of them is
      // a 200. Only a genuine processing failure (caught below) should
      // make Stripe retry.
      { status: 200, headers },
    );
  } catch (error) {
    // A thrown error here means `ProcessStripeConnectWebhookUseCase`
    // already marked the claimed event FAILED (re-claimable by Stripe's
    // own retry — see that use case's own doc comment) before rethrowing
    // — `toHttpErrorResponse` never itself decides retry semantics, it
    // only ever produces a safe, non-2xx response, which is exactly what
    // makes Stripe retry the delivery.
    return toHttpErrorResponse(error, { requestId, route });
  }
});
