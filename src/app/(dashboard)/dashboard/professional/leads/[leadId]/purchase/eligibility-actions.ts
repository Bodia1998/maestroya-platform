"use server";

import type { LeadPurchaseEligibilityDTO } from "@/application/use-cases/lead-purchase-eligibility/get-my-lead-purchase-eligibility.use-case";
import { makeGetMyLeadPurchaseEligibilityUseCase } from "@/application/use-cases/lead-purchase-eligibility/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError } from "@/presentation/i18n/server";

/**
 * Module 147 — read-only eligibility GUIDANCE for the caller's own purchase page. It takes NO input:
 * identity comes only from the session, so there is no client-supplied user, profile or billing value
 * to forge. The answer (a flag and a closed reason code) is display-only; it is NOT the security
 * boundary — `startLeadPurchaseAction` and payment initiation enforce the same policy server-side.
 */
export type LeadPurchaseEligibilityResult = { success: true; eligibility: LeadPurchaseEligibilityDTO } | { success: false; error: string };

export async function getMyLeadPurchaseEligibilityAction(): Promise<LeadPurchaseEligibilityResult> {
  const user = await requireAuth();
  try {
    return { success: true, eligibility: await makeGetMyLeadPurchaseEligibilityUseCase().execute(user.id) };
  } catch (error) {
    return { success: false, error: await localizeActionError(error) };
  }
}
