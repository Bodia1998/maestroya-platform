import type { PlatformAnalyticsRepository } from "@/domain/repositories/analytics-repository";
import { resolveAnalyticsDateRange, safeRatio } from "@/domain/services/analytics-date-range";
import type { AnalyticsDateRangeInput, AnalyticsFunnelDTO } from "@/application/dto/analytics.dto";

/**
 * Module 23 — Analytics: admin-only service funnel — Request Created ->
 * Quotes Received -> Quote Accepted -> Booking Created -> Job Completed.
 * See AnalyticsFunnelDTO's own doc comment for exactly which lifecycle
 * states each stage reads (all pre-existing states from Modules 06–11,
 * nothing invented here) and PrismaPlatformAnalyticsRepository.
 * getFunnelCounts's doc comment for why the acceptance -> booking stage is
 * expected to track close to 1:1 in this codebase's actual state machine.
 *
 * Every conversion rate is `null` (never `0`) when its denominator is
 * zero — see domain/services/analytics-date-range.ts#safeRatio.
 */
export class GetPlatformFunnelUseCase {
  constructor(private readonly analytics: PlatformAnalyticsRepository) {}

  async execute(input: AnalyticsDateRangeInput): Promise<AnalyticsFunnelDTO> {
    const resolved = resolveAnalyticsDateRange(input);
    const counts = await this.analytics.getFunnelCounts(resolved);

    return {
      range: { from: resolved.from, to: resolved.to },
      ...counts,
      requestToQuoteRate: safeRatio(counts.requestsWithQuotes, counts.requestsCreated),
      quoteToAcceptanceRate: safeRatio(counts.requestsWithAcceptedQuote, counts.requestsWithQuotes),
      acceptanceToBookingRate: safeRatio(counts.requestsWithBooking, counts.requestsWithAcceptedQuote),
      bookingToCompletionRate: safeRatio(counts.requestsCompleted, counts.requestsWithBooking),
      overallCompletionRate: safeRatio(counts.requestsCompleted, counts.requestsCreated),
    };
  }
}
