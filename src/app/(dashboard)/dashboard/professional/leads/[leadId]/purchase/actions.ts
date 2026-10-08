"use server";

import type { LeadPurchaseCheckoutDTO } from "@/application/dto/lead-purchase-checkout.dto";
import { makeGetLeadPurchaseCheckoutUseCase, makeInitiateLeadPurchaseUseCase } from "@/application/use-cases/lead-checkout/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 144 — checkout entry points for the professional LEAD_V1 purchase page.
 *
 * Thin adapters over existing application boundaries; no business rule lives here:
 *  - `getLeadPurchaseCheckoutAction` is a read of the caller's own purchase state (also used for
 *    the bounded status polling while Module 141's verified webhook confirms the payment);
 *  - `startLeadPurchaseAction` calls the existing M126/M135 `InitiateLeadPurchaseUseCase` (the
 *    idempotent PENDING_PAYMENT creation, no price input) and then re-reads the authoritative state.
 *
 * Payment initiation (M140) and the contact (M138) are NOT re-exposed here: the page uses the
 * existing `initiateLeadFeePaymentAction` and `getLeadContactAction` as they are.
 *
 * Identity comes ONLY from the session. The client supplies a lead id, never a user, professional,
 * customer, amount, currency or payment identifier. Nothing returned contains contact data.
 */
export type LeadPurchaseCheckoutResult = { success: true; purchase: LeadPurchaseCheckoutDTO | null } | { success: false; error: string };
export type StartLeadPurchaseResult = { success: true; purchase: LeadPurchaseCheckoutDTO } | { success: false; error: string };

export async function getLeadPurchaseCheckoutAction(leadId: unknown): Promise<LeadPurchaseCheckoutResult> {
  const user = await requireAuth();
  try {
    const purchase = await makeGetLeadPurchaseCheckoutUseCase().execute(user.id, leadId as string);
    return { success: true, purchase };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}

export async function startLeadPurchaseAction(leadId: unknown): Promise<StartLeadPurchaseResult> {
  const user = await requireAuth();
  try {
    await makeInitiateLeadPurchaseUseCase().execute(user.id, leadId as string);
    const purchase = await makeGetLeadPurchaseCheckoutUseCase().execute(user.id, leadId as string);
    if (!purchase) return { success: false, error: await localizeActionError(new Error("purchase not readable after initiation")) };
    return { success: true, purchase };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}
