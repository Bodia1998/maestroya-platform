import type { PlatformAnalyticsRepository } from "@/domain/repositories/analytics-repository";
import { resolveAnalyticsDateRange } from "@/domain/services/analytics-date-range";
import type { AnalyticsCategoryBreakdownDTO, AnalyticsDateRangeInput } from "@/application/dto/analytics.dto";

/** Module 23 — Analytics: admin-only per-category funnel counts. Reuses
 *  the existing ServiceCategory aggregate (see
 *  PrismaPlatformAnalyticsRepository.getCategoryBreakdown's own doc
 *  comment) rather than duplicating category business rules. */
export class GetPlatformCategoryBreakdownUseCase {
  constructor(private readonly analytics: PlatformAnalyticsRepository) {}

  async execute(input: AnalyticsDateRangeInput): Promise<AnalyticsCategoryBreakdownDTO[]> {
    const range = resolveAnalyticsDateRange(input);
    return this.analytics.getCategoryBreakdown(range);
  }
}
