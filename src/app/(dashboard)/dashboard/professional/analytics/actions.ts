"use server";

import { analyticsDateRangeSchema, type ProfessionalAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";
import { makeGetProfessionalAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

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
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid date range." };
  }
  try {
    const data = await makeGetProfessionalAnalyticsSummaryUseCase().execute(user.id, parsed.data);
    return { success: true, data };
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: error.message };
    }
    console.error(error);
    return { success: false, error: "Something went wrong loading your analytics." };
  }
}
