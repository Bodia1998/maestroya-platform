"use server";

import { getTranslations } from "next-intl/server";

import { analyticsDateRangeSchema, type ProfessionalAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";
import { makeGetProfessionalAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/**
 * Module 23 — Analytics: professional-facing Server Action. Only
 * `requireAuth()` is needed (not a role check) because ownership is
 * enforced one layer down, inside GetProfessionalAnalyticsSummaryUseCase,
 * by re-deriving the caller's own ProfessionalProfile from their session
 * `userId` — there is no `professionalId` parameter anywhere in this file
 * or the DTO it validates against, so there is no way to call this and
 * get back another professional's analytics (see that use case's own doc
 * comment for the full security rationale, matching
 * GetProfessionalEarningsUseCase's existing pattern for Module 22).
 */

export type ProfessionalAnalyticsActionResult =
  | { success: true; data: ProfessionalAnalyticsSummaryDTO }
  | { success: false; error: string };

export async function getProfessionalAnalyticsSummaryAction(
  input: { from?: Date; to?: Date } = {},
): Promise<ProfessionalAnalyticsActionResult> {
  const user = await requireAuth();
  const parsed = analyticsDateRangeSchema.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: await localizeZodError(parsed.error, t("invalidDateRange")) };
  }
  try {
    const data = await makeGetProfessionalAnalyticsSummaryUseCase().execute(user.id, parsed.data);
    return { success: true, data };
  } catch (error) {
    const t = await getTranslations("professional.errors");
    return { success: false, error: await localizeActionError(error, t("loadAnalytics")) };
  }
}
