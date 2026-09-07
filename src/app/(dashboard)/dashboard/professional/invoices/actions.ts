"use server";

import { revalidatePath } from "next/cache";

import { makeAcceptInvoiceUseCase } from "@/application/use-cases/invoicing/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

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

function fromDomainError(error: unknown, fallback: string): ActionResult {
  if (error instanceof DomainError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

export async function acceptProfessionalInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const user = await requireAuth();
  if (!invoiceId) {
    return { success: false, error: "Invalid invoice." };
  }

  try {
    await makeAcceptInvoiceUseCase().execute(user.id, invoiceId);
    revalidatePath(`/dashboard/professional/invoices/${invoiceId}`);
    revalidatePath("/dashboard/professional/invoices");
    return { success: true };
  } catch (error) {
    return fromDomainError(error, "Something went wrong accepting this invoice.");
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
