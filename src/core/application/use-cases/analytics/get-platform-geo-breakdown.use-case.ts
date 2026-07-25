import type { PlatformAnalyticsRepository } from "@/domain/repositories/analytics-repository";
import { resolveAnalyticsDateRange } from "@/domain/services/analytics-date-range";
import type { AnalyticsDateRangeInput, AnalyticsGeoBreakdownDTO } from "@/application/dto/analytics.dto";

/**
 * Module 23 — Analytics: admin-only coarse geographic breakdown (city/
 * province only). Never exposes a precise address or coordinate — see
 * PrismaPlatformAnalyticsRepository.getCityBreakdown's doc comment and
 * docs/MODULE_23_ANALYTICS.md, "Privacy," for why this deliberately stops
 * short of the Maps & Geolocation module's own coordinate data.
 */
export class GetPlatformGeoBreakdownUseCase {
  constructor(private readonly analytics: PlatformAnalyticsRepository) {}

  async execute(input: AnalyticsDateRangeInput): Promise<AnalyticsGeoBreakdownDTO[]> {
    const range = resolveAnalyticsDateRange(input);
    return this.analytics.getCityBreakdown(range);
  }
}
