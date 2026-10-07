"use server";

import type { LeadFeePaymentInitiationDTO } from "@/application/dto/lead-fee-payment.dto";
import { makeInitiateLeadFeePaymentUseCase } from "@/application/use-cases/lead-fee-payment/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 140 — start paying the LEAD_V1 lead fee of the caller's own purchase. The only
 * input is the purchase id (never an amount, currency or professional id); identity comes
 * ONLY from the session and the amount from the persisted purchase snapshot. Returns the
 * minimum the frontend needs to continue (client secret, exact total, currency). It does
 * NOT confirm the purchase or unlock contact: the purchase stays PENDING_PAYMENT until
 * Module 141's verified webhook.
 *
 * Kept out of `actions.ts` on purpose: that file is the read-only preview / feed / contact
 * entry point and its contract tests (M125, M139) keep it free of purchase and payment code.
 */
export type InitiateLeadFeePaymentResult = { success: true; payment: LeadFeePaymentInitiationDTO } | { success: false; error: string };

export async function initiateLeadFeePaymentAction(purchaseId: unknown): Promise<InitiateLeadFeePaymentResult> {
  const user = await requireAuth();
  try {
    const payment = await makeInitiateLeadFeePaymentUseCase().execute(user.id, purchaseId as string);
    return { success: true, payment };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}
