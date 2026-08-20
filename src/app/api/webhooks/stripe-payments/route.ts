import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getStripePaymentWebhookVerifierInstance,
  makeProcessCustomerPaymentWebhookUseCase,
} from "@/application/use-cases/payments/compose";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 73 — Real Customer Payment Capture: the customer-payment webhook
 * delivery endpoint. Deliberately a *separate* route from
 * `/api/webhooks/stripe` (Module 72, Connect-account events) rather than
 * an expansion of that handler — see `StripePaymentWebhookVerifier`'s own
 * doc comment for why. Configure this exact URL
 * (`<platform base URL>/api/webhooks/stripe-payments`) as a **platform**
 * Stripe webhook endpoint (no "Events from: Connected accounts") in the
 * Stripe Dashboard, subscribed to: `payment_intent.amount_capturable_updated`,
 * `payment_intent.succeeded`, `payment_intent.payment_failed`,
 * `payment_intent.canceled`, `charge.refunded`.
 *
 * Thin Route Handler — identical shape to `/api/webhooks/stripe/route.ts`:
 *   HTTP -> raw body -> signature verification
 *        (`StripePaymentWebhookVerifier`)
 *        -> event/idempotency handling + application use case
 *           (`ProcessCustomerPaymentWebhookUseCase`)
 *        -> HTTP response
 * No business logic, no Stripe-specific parsing, and no signature
 * verification logic lives in this file.
 *
 * ## Fail-closed checklist (mirrors `/api/webhooks/stripe/route.ts` exactly)
 * - The raw body is read once, as text, and handed to the verifier before
 *   anything in it is ever parsed or trusted — Stripe's signature is an
 *   HMAC over the *exact* raw bytes.
 * - Missing/invalid `stripe-signature` header, or a body that fails
 *   `stripe.webhooks.constructEvent`'s own check -> `verify` returns
 *   `{ valid: false }` -> 401. Never processed.
 * - The webhook must never trust client-side state: every field this
 *   route (transitively, via the use case) acts on is either the
 *   already-verified event's own opaque PaymentIntent id, or re-read from
 *   this platform's own persisted Payment/Quote — never anything a
 *   customer's browser could have sent.
 *
 * ## Idempotency / duplicate delivery
 * `ProcessCustomerPaymentWebhookUseCase` claims
 * `(STRIPE_PAYMENTS, event.id)` before doing anything else — a duplicate
 * delivery is acknowledged (200) with zero re-processing.
 *
 * ## Never logs sensitive data
 * Only the request id, outcome, and (once verified) the non-sensitive
 * `event.id`/`event.type`/PaymentIntent id are ever logged — never the raw
 * webhook body, the `Stripe-Signature` header, `STRIPE_PAYMENTS_WEBHOOK_SECRET`,
 * or any card/payment-method detail.
 */
export const POST = withApiTracing("/api/webhooks/stripe-payments", async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };
  const route = "/api/webhooks/stripe-payments";

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    logger.warn("stripe_payments_webhook_unreadable_body", { requestId, route });
    return NextResponse.json({ error: "Unable to read request body." }, { status: 400, headers });
  }

  const signatureHeader = request.headers.get("stripe-signature");

  const verifier = getStripePaymentWebhookVerifierInstance();
  const validation = verifier.verify(rawBody, signatureHeader);

  if (!validation.valid) {
    logger.warn("stripe_payments_webhook_signature_invalid", { requestId, route });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401, headers });
  }

  try {
    const result = await makeProcessCustomerPaymentWebhookUseCase().execute(validation.event);

    logger.info("stripe_payments_webhook_processed", {
      requestId,
      route,
      outcome: result.outcome,
      eventId: validation.event.id,
      eventType: validation.event.type,
      paymentId: result.paymentId,
    });

    return NextResponse.json(
      { status: result.outcome, requestId },
      // Every outcome here — captured, failed, cancelled, a refund merely
      // observed, a legitimately duplicate delivery, an event type this
      // route doesn't act on, or a PaymentIntent id this platform never
      // issued — is something Stripe must never retry, so every one of
      // them is a 200. Only a genuine processing failure (caught below)
      // should make Stripe retry.
      { status: 200, headers },
    );
  } catch (error) {
    return toHttpErrorResponse(error, { requestId, route });
  }
});
