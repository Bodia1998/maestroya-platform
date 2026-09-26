"use server";

import { getTranslations } from "next-intl/server";

import { analyticsDateRangeSchema, type CustomerAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";
import { makeGetCustomerAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { localizeActionError, localizeZodError } from "@/presentation/i18n/server";

/**
 * Module 23 — Analytics: customer-facing Server Action, placed at the
 * top-level `/analytics` route alongside this codebase's other
 * customer-oriented top-level routes (`/requests`, `/jobs`, `/reviews`) —
 * there is no dedicated `dashboard/customer` namespace to nest under (see
 * the app directory layout).
 *
 * Only `requireAuth()` is needed (not a role check): ownership is enforced
 * one layer down, inside GetCustomerAnalyticsSummaryUseCase, by
 * re-deriving the caller's own CustomerProfile from their session
 * `userId` — same "no client-supplied ownership id" pattern
 * GetCustomerFinancialSummaryUseCase already uses for a single Job.
 */

export type CustomerAnalyticsActionResult =
  | { success: true; data: CustomerAnalyticsSummaryDTO }
  | { success: false; error: string };

export async function getCustomerAnalyticsSummaryAction(
  input: { from?: Date; to?: Date } = {},
): Promise<CustomerAnalyticsActionResult> {
  const user = await requireAuth();
  const parsed = analyticsDateRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const data = await makeGetCustomerAnalyticsSummaryUseCase().execute(user.id, parsed.data);
    return { success: true, data };
  } catch (error) {
    // Module 120: domain errors localized; anything else logged + localized fallback.
    const t = await getTranslations("customer.analytics");
    return { success: false, error: await localizeActionError(error, t("loadFailed")) };
  }
}
