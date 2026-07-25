import { ValidationError } from "@/domain/errors/domain-error";
import type { CustomerAnalyticsRepository } from "@/domain/repositories/analytics-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { FinancialReportingRepository } from "@/domain/repositories/financial-reporting-repository";
import { resolveAnalyticsDateRange, safeRatio } from "@/domain/services/analytics-date-range";
import { roundToCents } from "@/domain/services/money";
import type { AnalyticsDateRangeInput, CustomerAnalyticsSummaryDTO } from "@/application/dto/analytics.dto";

/**
 * Module 23 — Analytics: a customer's own activity summary.
 *
 * Security: `customerProfileId` is never accepted from the caller — always
 * re-derived from the authenticated `userId` via
 * `CustomerProfileRepository.findByUserId`, the identical pattern
 * GetCustomerFinancialSummaryUseCase already uses for a single Job. A user
 * with no customer profile gets an empty-shaped summary via
 * `findOrCreateByUserId` semantics being unnecessary here — this use case
 * uses the plain `findByUserId` lookup and reports a ValidationError for
 * "no profile at all," never another customer's data.
 *
 * Spending figures come from Module 22's own
 * `FinancialReportingRepository.getCustomerSpendAggregate` — see that
 * method's doc comment for why it lives on Module 22's boundary rather
 * than being computed here.
 */
export class GetCustomerAnalyticsSummaryUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly analytics: CustomerAnalyticsRepository,
    private readonly financialReporting: FinancialReportingRepository,
  ) {}

  async execute(userId: string, input: AnalyticsDateRangeInput): Promise<CustomerAnalyticsSummaryDTO> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new ValidationError("You must have a customer profile to view analytics.");
    }

    const resolved = resolveAnalyticsDateRange(input);

    const [summary, spend] = await Promise.all([
      this.analytics.getSummary(customer.id, resolved),
      this.financialReporting.getCustomerSpendAggregate(userId, {
        from: resolved.from ?? undefined,
        to: resolved.to ?? undefined,
      }),
    ]);

    return {
      range: { from: resolved.from, to: resolved.to },
      requestsCreated: summary.requestsCreated,
      requestsByStatus: summary.requestsByStatus,
      quotes: {
        received: summary.quotesReceived,
        accepted: summary.quotesAccepted,
        acceptanceRate: safeRatio(summary.quotesAccepted, summary.quotesReceived),
      },
      bookings: {
        created: summary.bookingsCreated,
        completed: summary.bookingsCompleted,
        cancelled: summary.bookingsCancelled,
      },
      jobsCompleted: summary.jobsCompleted,
      reviews: {
        submitted: summary.reviewsSubmitted,
        averageRatingGiven: summary.averageRatingGiven,
      },
      spending: {
        totalPaid: roundToCents(spend.totalPaid),
        refundsTotal: roundToCents(spend.refundsTotal),
        paymentCount: spend.paymentCount,
        averageJobValue: safeRatio(spend.totalPaid, summary.jobsCompleted),
      },
    };
  }
}
