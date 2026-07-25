"use server";

import { analyticsDateRangeSchema, type CustomerAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";
import { makeGetCustomerAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/compose";
import { DomainError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

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
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid date range." };
  }
  try {
    const data = await makeGetCustomerAnalyticsSummaryUseCase().execute(user.id, parsed.data);
    return { success: true, data };
  } catch (error) {
    if (error instanceof DomainError) {
      return { success: false, error: error.message };
    }
    console.error(error);
    return { success: false, error: "Something went wrong loading your analytics." };
  }
}
