"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { makeAcceptInvoiceUseCase } from "@/application/use-cases/invoicing/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Thin Server Action adapter for the professional/company invoice-detail
 * page. `AcceptInvoiceUseCase` already resolves ownership entirely from
 * `userId` + `invoiceId` internally (see that use case's own doc comment) —
 * this action never trusts anything about the caller beyond the
 * authenticated session, and `invoiceId` is always re-verified server-side
 * by the use case, never treated as proof of ownership just because it was
 * passed in.
 */

export type ActionResult = { success: true } | { success: false; error: string };

// Module 120 — errors are localised at the edge (`localizeActionError`):
// domain errors map to their catalog sentence, anything else is logged
// server-side and replaced with the localised fallback.
type FallbackKey =
  | "acceptInvoice";

async function fromDomainError(error: unknown, fallbackKey: FallbackKey): Promise<ActionResult> {
  const t = await getTranslations("professional.errors");
  return { success: false, error: await localizeActionError(error, t(fallbackKey)) };
}

export async function acceptProfessionalInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const user = await requireAuth();
  if (!invoiceId) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: t("invalidInvoice") };
  }

  try {
    await makeAcceptInvoiceUseCase().execute(user.id, invoiceId);
    revalidatePath(`/dashboard/professional/invoices/${invoiceId}`);
    revalidatePath("/dashboard/professional/invoices");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "acceptInvoice");
  }
}

// ---------------------------------------------------------------------------
// Form-bindable wrapper
// ---------------------------------------------------------------------------
// Same convention as verification/actions.ts's own form wrappers — a thin
// Promise<void>-returning wrapper around the ActionResult-returning action
// above, needed for <form action={...}> type compatibility. Goes through the
// exact same requireAuth() + use case, no second code path.

export async function acceptProfessionalInvoiceFormAction(invoiceId: string): Promise<void> {
  await acceptProfessionalInvoiceAction(invoiceId);
}
