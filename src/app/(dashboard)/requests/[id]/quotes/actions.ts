"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { makeAcceptQuoteUseCase } from "@/application/use-cases/quotes/compose";
import { localizeActionError } from "@/presentation/i18n/server";

export type ActionResult =
  | { success: true }
  | { success: false; error: string };


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
    // Module 120: domain errors localized, anything else logged + localized fallback.
    const t = await getTranslations("customer");
    return { success: false, error: await localizeActionError(error, t("quotes.acceptFailed")) };
  }
}
