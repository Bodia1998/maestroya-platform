"use server";

import { revalidatePath } from "next/cache";

import { adminActionFailure } from "../_lib/action-errors";
import { localizeZodError } from "@/presentation/i18n/server";
import { rejectBillingIdentitySchema, verifyBillingIdentitySchema } from "@/application/dto/professional-billing-identity.dto";
import {
  makeRejectBillingIdentityUseCase,
  makeVerifyBillingIdentityUseCase,
} from "@/application/use-cases/billing-identity/compose";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Module 146 — the administrator boundary for professional billing identities
 * (the ONLY way a billing identity becomes VERIFIED or REJECTED). Same discipline
 * as the M17 verification actions: `requireRole(ADMIN, SUPER_ADMIN)` is the first
 * statement, input is Zod-validated, the acting admin id comes from the session,
 * and the decision is bound to the `expectedRevision` the admin reviewed.
 *
 * NOTE (operational gap, documented in docs/MODULE_146_PROFESSIONAL_BILLING_IDENTITY.md):
 * no admin review page exists yet — building the review queue UI is deliberately
 * out of M146's scope. These actions plus the list/get use cases are the boundary
 * a future operations console (M157) will call.
 */
export type BillingIdentityReviewActionResult = { success: true } | { success: false; error: string };

export async function verifyBillingIdentityAction(identityId: string, expectedRevision: number): Promise<BillingIdentityReviewActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = verifyBillingIdentitySchema.safeParse({ identityId, expectedRevision });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeVerifyBillingIdentityUseCase().execute(admin.id, parsed.data);
    revalidatePath("/admin/billing-identities");
    return { success: true };
  } catch (error) {
    return adminActionFailure(error, "reviewingThisBillingIdentity");
  }
}

export async function rejectBillingIdentityAction(
  identityId: string,
  expectedRevision: number,
  reason: string,
  note?: string,
): Promise<BillingIdentityReviewActionResult> {
  const admin = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = rejectBillingIdentitySchema.safeParse({ identityId, expectedRevision, reason, note });
  if (!parsed.success) return { success: false, error: await localizeZodError(parsed.error) };
  try {
    await makeRejectBillingIdentityUseCase().execute(admin.id, parsed.data);
    revalidatePath("/admin/billing-identities");
    return { success: true };
  } catch (error) {
    return adminActionFailure(error, "reviewingThisBillingIdentity");
  }
}
