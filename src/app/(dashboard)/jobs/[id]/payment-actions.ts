"use server";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeInitiateQuotePaymentUseCase } from "@/application/use-cases/payments/compose";

export type InitiatePaymentActionResult =
  | { success: true; paymentId: string; clientSecret: string | null; amount: number; currency: string }
  | { success: false; error: string };

// Same translation convention as every other module's actions.ts (see
// requests/[id]/quotes/actions.ts): domain errors surface their own
// (safe, user-facing) message, anything else is logged server-side and
// replaced with a generic message.
function fromDomainError(error: unknown, fallback: string): InitiatePaymentActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

/**
 * Module 73 — Real Customer Payment Capture: starts (or idempotently
 * resumes) payment for the authenticated customer's own Job. `jobId` is
 * re-verified against the session inside `InitiateQuotePaymentUseCase` —
 * never trusted as proof of ownership just because it was passed in. See
 * that use case's own doc comment for the full authorization/idempotency
 * contract.
 *
 * Returns `clientSecret` so the client can complete card confirmation via
 * Stripe.js (`stripe.confirmCardPayment(clientSecret, ...)`) — this action
 * never itself collects card details, and there is no corresponding
 * "confirm" action: the rest of the payment lifecycle is driven entirely
 * by Stripe webhooks (`ProcessCustomerPaymentWebhookUseCase`), never by a
 * second server round trip from this page.
 */
export async function initiatePaymentAction(jobId: string): Promise<InitiatePaymentActionResult> {
  const user = await requireAuth();

  try {
    const result = await makeInitiateQuotePaymentUseCase().execute(user.id, jobId);
    return { success: true, ...result };
  } catch (error) {
    return fromDomainError(error, "Something went wrong starting your payment. Please try again.");
  }
}
