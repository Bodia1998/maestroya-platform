import type { PlatformAnalyticsRepository, AnalyticsRange } from "@/domain/repositories/analytics-repository";
import { resolveAnalyticsDateRange, safeRatio } from "@/domain/services/analytics-date-range";
import type { AnalyticsDateRangeInput, PlatformAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";
import type { GetPlatformRevenueSummaryUseCase } from "@/application/use-cases/financial/get-platform-revenue-summary.use-case";

/**
 * Module 23 — Analytics: the platform/admin-facing summary. Authorization
 * is enforced by the caller (`requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`
 * in the Server Action, before this use case is ever invoked) — same
 * boundary convention as GetAdminDashboardOverviewUseCase/
 * GetPlatformRevenueSummaryUseCase, both of which this use case sits
 * directly alongside. This use case itself has no notion of "who is
 * asking."
 *
 * Financial figures are obtained by calling Module 22's own
 * GetPlatformRevenueSummaryUseCase unmodified — this file performs no
 * commission/revenue arithmetic of its own (see PlatformAnalyticsSummaryDTO's
 * `financial` field doc comment).
 */
export class GetPlatformAnalyticsSummaryUseCase {
  constructor(
    private readonly analytics: PlatformAnalyticsRepository,
    private readonly platformRevenue: GetPlatformRevenueSummaryUseCase,
  ) {}

  async execute(input: AnalyticsDateRangeInput): Promise<PlatformAnalyticsSummaryDTO> {
    const resolved = resolveAnalyticsDateRange(input);
    const range: AnalyticsRange = resolved;

    const [users, professionals, companies, serviceRequests, quotes, bookings, jobs, reviews, financial] =
      await Promise.all([
        this.analytics.getUserAggregate(range),
        this.analytics.getProfessionalAggregate(range),
        this.analytics.getCompanyAggregate(range),
        this.analytics.getServiceRequestAggregate(range),
        this.analytics.getQuoteAggregate(range),
        this.analytics.getBookingAggregate(range),
        this.analytics.getJobAggregate(range),
        this.analytics.getReviewAggregate(range),
        this.platformRevenue.execute({ from: resolved.from ?? undefined, to: resolved.to ?? undefined }),
      ]);

    return {
      range: { from: resolved.from, to: resolved.to },
      users,
      professionals,
      companies,
      serviceRequests: {
        total: serviceRequests.total,
        newInPeriod: serviceRequests.newInPeriod,
        byStatus: serviceRequests.byStatus,
        openRequests: serviceRequests.openRequests,
        cancelledRequests: serviceRequests.cancelledRequests,
        completedRequests: serviceRequests.completedRequests,
      },
      quotes: {
        total: quotes.total,
        accepted: quotes.accepted,
        rejected: quotes.rejected,
        expired: quotes.expired,
        withdrawn: quotes.withdrawn,
        pendingOrSent: quotes.pendingOrSent,
        averageAmount: quotes.averageAmount,
        acceptanceRate: safeRatio(quotes.accepted, quotes.total),
      },
      bookings: {
        total: bookings.total,
        confirmed: bookings.confirmed,
        completed: bookings.completed,
        cancelled: bookings.cancelled,
        conversionRate: safeRatio(bookings.completed, bookings.total),
      },
      jobs: {
        total: jobs.total,
        completed: jobs.completed,
        cancelled: jobs.cancelled,
        completionRate: safeRatio(jobs.completed, jobs.total),
      },
      reviews,
      financial,
    };
  }
}
