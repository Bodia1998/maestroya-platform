import { z } from "zod";

import type { AnalyticsDashboard, AnalyticsSnapshotSource } from "@/domain/entities/analytics-dashboard";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * Same convention as `search-read-model.dto.ts`: a zod schema validates
 * the query-side input, plain interfaces describe the stable, client-safe
 * response shape a use case/route returns.
 */
export const getDashboardAnalyticsQuerySchema = z.object({
  /** Bypasses the cached snapshot and forces a live recompute — the
   *  operator/debugging escape hatch, mirroring `GetOrSetOptions.bypass`
   *  (Module 46). Defaults to `false`: normal reads are cache-first. */
  forceRefresh: z.coerce.boolean().optional().default(false),
});
export type GetDashboardAnalyticsQueryInput = z.infer<typeof getDashboardAnalyticsQuerySchema>;

export interface AnalyticsDashboardResponseDTO {
  data: AnalyticsDashboard | null;
  computedAt: string;
  source: AnalyticsSnapshotSource;
  degraded: boolean;
}
