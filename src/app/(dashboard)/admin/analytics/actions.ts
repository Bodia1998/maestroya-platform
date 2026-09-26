"use server";

import { adminActionFailure } from "../_lib/action-errors";
import { localizeZodError } from "@/presentation/i18n/server";
import {
  analyticsDateRangeSchema,
  getAnalyticsTimeSeriesSchema,
  type AnalyticsCategoryBreakdownDTO,
  type AnalyticsFunnelDTO,
  type AnalyticsGeoBreakdownDTO,
  type AnalyticsTimeSeriesPointDTO,
  type PlatformAnalyticsSummaryDTO,
} from "@/application/dto/analytics.dto";
import {
  makeGetPlatformAnalyticsSummaryUseCase,
  makeGetPlatformCategoryBreakdownUseCase,
  makeGetPlatformFunnelUseCase,
  makeGetPlatformGeoBreakdownUseCase,
  makeGetPlatformRequestsTimeSeriesUseCase,
} from "@/application/use-cases/analytics/compose";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Module 23 — Analytics: admin-only Server Action adapters. Same pattern
 * as every other module's actions.ts (see admin/actions.ts) — every action
 * below calls `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` before doing
 * anything else, with no code path that trusts a client-supplied role.
 */

export type AnalyticsActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function getPlatformAnalyticsSummaryAction(
  input: { from?: Date; to?: Date } = {},
): Promise<AnalyticsActionResult<PlatformAnalyticsSummaryDTO>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = analyticsDateRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const data = await makeGetPlatformAnalyticsSummaryUseCase().execute(parsed.data);
    return { success: true, data };
  } catch (error) {
    return adminActionFailure(error, "loadingPlatformAnalytics");
  }
}

export async function getPlatformRequestsTimeSeriesAction(
  input: { from?: Date; to?: Date; granularity?: "DAY" | "WEEK" | "MONTH" },
): Promise<AnalyticsActionResult<AnalyticsTimeSeriesPointDTO[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = getAnalyticsTimeSeriesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const data = await makeGetPlatformRequestsTimeSeriesUseCase().execute(parsed.data);
    return { success: true, data };
  } catch (error) {
    return adminActionFailure(error, "loadingTheRequestsTimeSeries");
  }
}

export async function getPlatformCategoryBreakdownAction(
  input: { from?: Date; to?: Date } = {},
): Promise<AnalyticsActionResult<AnalyticsCategoryBreakdownDTO[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = analyticsDateRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const data = await makeGetPlatformCategoryBreakdownUseCase().execute(parsed.data);
    return { success: true, data };
  } catch (error) {
    return adminActionFailure(error, "loadingCategoryAnalytics");
  }
}

export async function getPlatformGeoBreakdownAction(
  input: { from?: Date; to?: Date } = {},
): Promise<AnalyticsActionResult<AnalyticsGeoBreakdownDTO[]>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = analyticsDateRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const data = await makeGetPlatformGeoBreakdownUseCase().execute(parsed.data);
    return { success: true, data };
  } catch (error) {
    return adminActionFailure(error, "loadingGeographicAnalytics");
  }
}

export async function getPlatformFunnelAction(
  input: { from?: Date; to?: Date } = {},
): Promise<AnalyticsActionResult<AnalyticsFunnelDTO>> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  const parsed = analyticsDateRangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: await localizeZodError(parsed.error) };
  }
  try {
    const data = await makeGetPlatformFunnelUseCase().execute(parsed.data);
    return { success: true, data };
  } catch (error) {
    return adminActionFailure(error, "loadingTheServiceFunnel");
  }
}
