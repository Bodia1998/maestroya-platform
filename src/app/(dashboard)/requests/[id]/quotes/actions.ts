"use server";

import { revalidatePath } from "next/cache";

import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeAcceptQuoteUseCase } from "@/application/use-cases/quotes/compose";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };

// Same translation convention as every other module's actions.ts: domain
// errors surface their own (safe, user-facing) message, anything else is
// logged server-side and replaced with a generic message.
function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

/**
 * Accepts one of the Quotes on the *authenticated* customer's own
 * ServiceRequest. `requestId`/`quoteId` are both re-verified against the
 * session inside AcceptQuoteUseCase — never trusted as proof of ownership
 * just because they were passed in. See AcceptQuoteUseCase's doc comment
 * for the full authorization/atomicity contract.
 */
export async function acceptQuoteAction(requestId: string, quoteId: string): Promise<ActionResult> {
  const user = await requireAuth();

  try {
    await makeAcceptQuoteUseCase().execute(user.id, requestId, quoteId);
    revalidatePath("/requests");
    revalidatePath(`/requests/${requestId}`);
    revalidatePath(`/requests/${requestId}/quotes`);
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong accepting this quote.");
  }
}
