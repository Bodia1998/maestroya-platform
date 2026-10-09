"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { requireAuth } from "@/infrastructure/auth/rbac";
import { saveBillingIdentitySchema } from "@/application/dto/professional-billing-identity.dto";
import { makeSaveMyBillingIdentityUseCase } from "@/application/use-cases/billing-identity/compose";
import { localizeActionError, localizeZodFieldErrors } from "@/presentation/i18n/server";

export type SaveBillingIdentityActionResult =
  | { success: true; state: "PENDING_REVIEW" | "VERIFIED" | "NEEDS_CORRECTION" | "MISSING" }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Module 146 — the professional saves THEIR OWN billing details.
 *
 * The acting professional is the session user (`requireAuth`); the payload has no
 * profile id, no status, no verification field (the schema strips unknown keys),
 * and the use case has no way to set a verification status. A successful save
 * therefore never verifies anything: it yields "pending review" (or, for
 * identical details, the unchanged state).
 */
export async function saveBillingIdentityAction(formData: unknown): Promise<SaveBillingIdentityActionResult> {
  const user = await requireAuth();

  const parsed = saveBillingIdentitySchema.safeParse(formData);
  if (!parsed.success) {
    const t = await getTranslations("professional.billing.errors");
    return { success: false, error: t("fixErrors"), fieldErrors: await localizeZodFieldErrors(parsed.error) };
  }

  try {
    const view = await makeSaveMyBillingIdentityUseCase().execute(user.id, parsed.data);
    revalidatePath("/dashboard/professional/billing");
    return { success: true, state: view.state };
  } catch (error) {
    const t = await getTranslations("professional.billing.errors");
    return { success: false, error: await localizeActionError(error, t("save")) };
  }
}
