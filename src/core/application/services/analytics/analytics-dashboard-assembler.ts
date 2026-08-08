import type { AnalyticsDashboard } from "@/domain/entities/analytics-dashboard";
import type {
  DisputeAnalyticsRepository,
  SupportTicketAnalyticsRepository,
} from "@/domain/repositories/analytics-extras-repository";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import type { GetPlatformAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/get-platform-analytics-summary.use-case";
import type { GetPlatformFunnelUseCase } from "@/application/use-cases/analytics/get-platform-funnel.use-case";

/** The one field of Module 48's `RealtimeHealthReport` shape this module
 *  actually needs — kept as a narrow structural type so this file (and
 *  its tests) never import the realtime application services directly,
 *  the same "narrow structural interface" convention `search-provider.ts`
 *  uses for `MeilisearchClientApi`. */
export interface RealtimeStatisticsSource {
  activeConnections: number;
  activeChannels: number;
  onlineUsers: number;
}

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * The single place "what does the dashboard read model look like right
 * now" is decided — this module's analogue of Module 47's
 * `SearchDocumentProjector`. Every source is read fresh (unranged/
 * all-time — see the class doc below), never trusted from a snapshot,
 * which is what makes re-running the assembler at any time produce a
 * correct, current dashboard: there is no incremental state to get out of
 * sync.
 *
 * ## Why every query here reads live from Postgres (via Module 23)
 * This class is *infrastructure-agnostic* — it depends only on
 * application-layer use cases and repository interfaces, never Prisma
 * directly — but every one of those dependencies does, in turn, read
 * Postgres, because that is the whole CQRS point: this class is the
 * *write side* of the read model (it produces the materialized snapshot
 * that `AnalyticsReadModelStore` then serves reads from), not a query
 * that runs on every dashboard view. See
 * `GetDashboardAnalyticsUseCase`/`RefreshAnalyticsReadModelUseCase` for
 * how the two sides are kept apart.
 *
 * ## Why the range is always unranged (all-time)
 * Module 23's own summary/funnel use cases accept a caller-supplied date
 * range; this module's cached dashboard deliberately does not vary by
 * range — see docs/MODULE_50_ANALYTICS_DASHBOARD.md, "Why one range," for
 * the full reasoning (a per-range cache would multiply the number of
 * artifacts to keep fresh with no KPI-dashboard use case asking for it
 * today; a ranged breakdown remains directly available by calling
 * Module 23's own use cases, unchanged, from a future ranged view).
 */
export class AnalyticsDashboardAssembler {
  constructor(
    private readonly platformSummary: GetPlatformAnalyticsSummaryUseCase,
    private readonly funnel: GetPlatformFunnelUseCase,
    private readonly disputes: DisputeAnalyticsRepository,
    private readonly supportTickets: SupportTicketAnalyticsRepository,
    private readonly searchProvider: SearchIndexProvider,
    private readonly realtimeStatistics: () => RealtimeStatisticsSource,
  ) {}

  async assemble(): Promise<AnalyticsDashboard> {
    const unranged = {};

    const [summary, funnel, disputeStats, supportTicketStats, searchStatus] = await Promise.all([
      this.platformSummary.execute(unranged),
      this.funnel.execute(unranged),
      this.disputes.getStatistics(),
      this.supportTickets.getStatistics(),
      this.searchProvider.ping(),
    ]);

    const realtime = this.realtimeStatistics();

    return {
      range: summary.range,
      growth: summary.users,
      professionals: summary.professionals,
      companies: summary.companies,
      marketplace: {
        serviceRequests: {
          total: summary.serviceRequests.total,
          newInPeriod: summary.serviceRequests.newInPeriod,
          openRequests: summary.serviceRequests.openRequests,
          cancelledRequests: summary.serviceRequests.cancelledRequests,
          completedRequests: summary.serviceRequests.completedRequests,
        },
        quotes: summary.quotes,
        funnel: {
          requestsCreated: funnel.requestsCreated,
          requestsWithQuotes: funnel.requestsWithQuotes,
          requestsWithAcceptedQuote: funnel.requestsWithAcceptedQuote,
          requestsWithBooking: funnel.requestsWithBooking,
          requestsCompleted: funnel.requestsCompleted,
          requestToQuoteRate: funnel.requestToQuoteRate,
          quoteToAcceptanceRate: funnel.quoteToAcceptanceRate,
          acceptanceToBookingRate: funnel.acceptanceToBookingRate,
          bookingToCompletionRate: funnel.bookingToCompletionRate,
          overallCompletionRate: funnel.overallCompletionRate,
        },
      },
      bookings: {
        bookings: summary.bookings,
        jobs: summary.jobs,
      },
      reviews: summary.reviews,
      revenue: summary.financial,
      disputes: disputeStats,
      supportTickets: supportTicketStats,
      search: {
        provider: searchStatus.provider,
        reachable: searchStatus.reachable,
        documentCount: searchStatus.documentCount,
      },
      realtime,
    };
  }
}
