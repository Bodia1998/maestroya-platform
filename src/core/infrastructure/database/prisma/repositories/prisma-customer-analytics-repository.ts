import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AnalyticsRange,
  AnalyticsStatusCount,
  CustomerAnalyticsRepository,
  CustomerAnalyticsSummaryCounts,
} from "@/domain/repositories/analytics-repository";

function dateFilter(range: AnalyticsRange) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

/**
 * Module 23 — Analytics: a single customer's own activity summary.
 * `customerProfileId` is always resolved server-side by the calling use
 * case from the authenticated user (see
 * GetCustomerAnalyticsSummaryUseCase) — same "never trust a client-
 * supplied id" boundary as GetCustomerFinancialSummaryUseCase.
 *
 * "Quotes received" is read via ServiceRequest -> Quote (a customer
 * receives quotes on requests they created; Quote has no direct
 * `customerId`), scoped through the indexed `customerId` on ServiceRequest
 * — bounded by this one customer's own request count, never a full Quote
 * table scan.
 */
export class PrismaCustomerAnalyticsRepository implements CustomerAnalyticsRepository {
  async getSummary(customerProfileId: string, range: AnalyticsRange): Promise<CustomerAnalyticsSummaryCounts> {
    const createdAt = dateFilter(range);
    const requestWhere = { customerId: customerProfileId, deletedAt: null, ...(createdAt ? { createdAt } : {}) };
    const jobWhere = { customerId: customerProfileId, ...(createdAt ? { createdAt } : {}) };

    const [
      requestsCreated,
      requestsByStatusGroups,
      quotesReceived,
      quotesAccepted,
      bookingsCreated,
      bookingsCompleted,
      bookingsCancelled,
      jobsCompleted,
      reviewsSubmittedAgg,
    ] = await Promise.all([
      prisma.serviceRequest.count({ where: requestWhere }),
      prisma.serviceRequest.groupBy({ by: ["status"], where: requestWhere, _count: { _all: true } }),
      prisma.quote.count({ where: { serviceRequest: { customerId: customerProfileId, deletedAt: null } } }),
      prisma.quote.count({
        where: { status: "ACCEPTED", serviceRequest: { customerId: customerProfileId, deletedAt: null } },
      }),
      prisma.appointment.count({
        where: { serviceRequest: { customerId: customerProfileId, deletedAt: null }, ...(createdAt ? { createdAt } : {}) },
      }),
      prisma.appointment.count({
        where: {
          status: "COMPLETED",
          serviceRequest: { customerId: customerProfileId, deletedAt: null },
          ...(createdAt ? { createdAt } : {}),
        },
      }),
      prisma.appointment.count({
        where: {
          status: "CANCELLED",
          serviceRequest: { customerId: customerProfileId, deletedAt: null },
          ...(createdAt ? { createdAt } : {}),
        },
      }),
      prisma.job.count({ where: { ...jobWhere, status: "COMPLETED" } }),
      // A customer's own reviews are always keyed by `reviewerId` (User.id)
      // — Review has no `customerProfileId` (see Review's doc comment: the
      // author is always a User) — so this one query resolves via the
      // ServiceRequest -> customer relation instead, same join shape as
      // the quote counts above.
      prisma.review.aggregate({
        where: { serviceRequest: { customerId: customerProfileId, deletedAt: null }, ...(createdAt ? { createdAt } : {}) },
        _count: { _all: true },
        _avg: { rating: true },
      }),
    ]);

    const requestsByStatus: AnalyticsStatusCount[] = requestsByStatusGroups.map((g) => ({
      status: g.status,
      count: g._count._all,
    }));

    return {
      requestsCreated,
      requestsByStatus,
      quotesReceived,
      quotesAccepted,
      bookingsCreated,
      bookingsCompleted,
      bookingsCancelled,
      jobsCompleted,
      reviewsSubmitted: reviewsSubmittedAgg._count._all,
      averageRatingGiven: reviewsSubmittedAgg._avg.rating ? Number(reviewsSubmittedAgg._avg.rating) : null,
    };
  }
}
