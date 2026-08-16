import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getVerificationProviderInstance,
  makeProcessPersonaWebhookUseCase,
} from "@/application/use-cases/verification/compose";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective A):
 * the previously-missing Route Handler for Persona's webhook deliveries —
 * the Module 70 audit's CRITICAL finding. `PersonaVerificationProvider`
 * already implemented `webhookValidation` (Module 59), but nothing ever
 * called it; this is that route.
 *
 * Thin Route Handler, per this module's own architectural rule:
 *   HTTP -> signature validation (existing `VerificationProvider` port)
 *        -> event/idempotency handling + application use case
 *           (`ProcessPersonaWebhookUseCase`)
 *        -> HTTP response
 * No business logic, no Persona-specific parsing, and no signature
 * verification logic lives in this file — every one of those already
 * exists in `PersonaVerificationProvider`/`ProcessPersonaWebhookUseCase`
 * and is only ever called from here, never re-implemented.
 *
 * ## Fail-closed checklist (see this module's own security requirements)
 * - Missing/invalid/malformed signature, missing timestamp, a timestamp
 *   outside the replay-protection tolerance, or no configured webhook
 *   secret at all -> `webhookValidation` returns `valid: false` -> 401.
 *   `NullVerificationProvider` (VERIFICATION_PROVIDER != "persona")
 *   returns `valid: false` unconditionally, so this route fails closed
 *   identically whether Persona is simply unconfigured or genuinely
 *   misconfigured.
 * - The raw body is read once and handed to `webhookValidation` before
 *   anything in it is ever parsed or trusted for a business decision —
 *   `ProcessPersonaWebhookUseCase` only ever receives the already-verified
 *   `externalEventId`/`eventType`/`providerVerificationId` fields
 *   `webhookValidation` extracted, never the raw body itself.
 * - A malformed body that still carries a genuinely valid signature is
 *   acknowledged (200) without processing, per `webhookValidation`'s own
 *   "signature valid, shape unexpected" precedent (see that method's doc
 *   comment) — never treated as a forged request.
 *
 * ## Idempotency / duplicate delivery
 * `ProcessPersonaWebhookUseCase` claims `(PERSONA, event.id)` via
 * `ExternalWebhookEventRepository` before doing anything else — a
 * duplicate delivery (Persona's own retry, or two concurrent deliveries)
 * is acknowledged (200) with zero re-processing. See that use case's own
 * doc comment.
 *
 * ## Never logs sensitive data
 * Only the request id, outcome, and (once verified) the non-sensitive
 * `externalEventId`/`eventType`/`providerVerificationId` fields are ever
 * logged — never the raw webhook body, the `Persona-Signature` header, or
 * `PERSONA_WEBHOOK_SECRET`.
 */
export const POST = withApiTracing("/api/webhooks/persona", async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };
  const route = "/api/webhooks/persona";

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    logger.warn("persona_webhook_unreadable_body", { requestId, route });
    return NextResponse.json({ error: "Unable to read request body." }, { status: 400, headers });
  }

  const signatureHeader = request.headers.get("persona-signature");

  const provider = getVerificationProviderInstance();
  const validation = provider.webhookValidation(rawBody, signatureHeader);

  if (!validation.valid) {
    // Deliberately generic — never distinguishes "no secret configured"
    // from "bad signature" from "stale timestamp" in the response, which
    // would help an attacker narrow down what's wrong with a forged
    // request. The real reason is only ever in the server-side log below.
    logger.warn("persona_webhook_signature_invalid", { requestId, route });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401, headers });
  }

  if (!validation.externalEventId) {
    // Signature genuinely valid (this request really came from Persona),
    // but the body's shape wasn't the envelope this platform recognizes —
    // acknowledge it so Persona doesn't retry indefinitely, but do not
    // attempt to process or idempotency-guard something unparseable.
    logger.warn("persona_webhook_unrecognized_shape", { requestId, route });
    return NextResponse.json({ status: "ignored" }, { status: 200, headers });
  }

  try {
    const result = await makeProcessPersonaWebhookUseCase().execute({
      externalEventId: validation.externalEventId,
      eventType: validation.eventType ?? null,
      providerVerificationId: validation.providerVerificationId ?? null,
    });

    logger.info("persona_webhook_processed", {
      requestId,
      route,
      outcome: result.outcome,
      externalEventId: validation.externalEventId,
      eventType: validation.eventType,
    });

    return NextResponse.json(
      { status: result.outcome, requestId },
      // Every outcome here — processed, a legitimately duplicate
      // delivery, an event type this platform doesn't act on, or an
      // inquiry id this platform never issued — is something the sender
      // must never retry, so every one of them is a 200. Only a genuine
      // processing failure (caught below) should make Persona retry.
      { status: 200, headers },
    );
  } catch (error) {
    return toHttpErrorResponse(error, { requestId, route });
  }
});
