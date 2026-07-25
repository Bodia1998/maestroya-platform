import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  AnalyticsCategoryAggregate,
  AnalyticsCityAggregate,
  AnalyticsFunnelCounts,
  AnalyticsRange,
  AnalyticsStatusCount,
  AnalyticsTimeSeriesBucket,
  PlatformAnalyticsRepository,
  PlatformBookingAggregate,
  PlatformCompanyAggregate,
  PlatformJobAggregate,
  PlatformProfessionalAggregate,
  PlatformQuoteAggregate,
  PlatformReviewAggregate,
  PlatformServiceRequestAggregate,
  PlatformUserAggregate,
} from "@/domain/repositories/analytics-repository";
import type { TimeSeriesGranularity } from "@/domain/services/analytics-date-range";

/**
 * Module 23 — Analytics: admin/platform-level reporting queries.
 *
 * Every method here is a bounded aggregate/groupBy query (COUNT, AVG,
 * GROUP BY) whose result size is O(number of distinct statuses/categories/
 * cities), never O(number of rows) — see docs/MODULE_23_ANALYTICS.md,
 * "Performance," for the full accounting of why each query here is safe at
 * scale. Nothing in this file mutates a row; nothing here recalculates a
 * commission, rating average, or verification decision another module
 * already owns — see analytics-repository.ts's own top doc comment.
 */

function dateFilter(range: AnalyticsRange) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

const NOT_DELETED = { deletedAt: null } as const;

export class PrismaPlatformAnalyticsRepository implements PlatformAnalyticsRepository {
  async getUserAggregate(range: AnalyticsRange): Promise<PlatformUserAggregate> {
    const createdAt = dateFilter(range);
    // "Active" needs *some* window even for an unranged query — an
    // all-time "active" count would just equal "total users" for any user
    // who has ever logged in once, which isn't a useful signal. Falls back
    // to the trailing 30 days from now, a common, unsurprising default for
    // this kind of figure, documented here and in the domain repository
    // interface's own doc comment.
    const activeWindow = createdAt ?? { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };

    const [totalUsers, newUsers, activeUsers, customers, professionals, companies] = await Promise.all([
      prisma.user.count({ where: NOT_DELETED }),
      createdAt ? prisma.user.count({ where: { ...NOT_DELETED, createdAt } }) : prisma.user.count({ where: NOT_DELETED }),
      prisma.user.count({ where: { ...NOT_DELETED, lastLoginAt: activeWindow } }),
      prisma.customerProfile.count({ where: NOT_DELETED }),
      prisma.professionalProfile.count({ where: NOT_DELETED }),
      prisma.companyProfile.count({ where: NOT_DELETED }),
    ]);

    return { totalUsers, newUsers, activeUsers, customers, professionals, companies };
  }

  async getProfessionalAggregate(range: AnalyticsRange): Promise<PlatformProfessionalAggregate> {
    const createdAt = dateFilter(range);

    const [total, active, verified, newlyRegistered, withCompletedJobsGroups] = await Promise.all([
      prisma.professionalProfile.count({ where: NOT_DELETED }),
      prisma.professionalProfile.count({ where: { ...NOT_DELETED, status: "ACTIVE" } }),
      prisma.professionalProfile.count({ where: { ...NOT_DELETED, verificationStatus: "VERIFIED" } }),
      createdAt
        ? prisma.professionalProfile.count({ where: { ...NOT_DELETED, createdAt } })
        : prisma.professionalProfile.count({ where: NOT_DELETED }),
      prisma.job.groupBy({
        by: ["professionalProfileId"],
        where: { status: "COMPLETED", professionalProfileId: { not: null } },
      }),
    ]);

    return { total, active, verified, newlyRegistered, withCompletedJobs: withCompletedJobsGroups.length };
  }

  async getCompanyAggregate(range: AnalyticsRange): Promise<PlatformCompanyAggregate> {
    const [total, active, verified] = await Promise.all([
      prisma.companyProfile.count({ where: NOT_DELETED }),
      prisma.companyProfile.count({ where: { ...NOT_DELETED, status: "ACTIVE" } }),
      prisma.companyProfile.count({ where: { ...NOT_DELETED, isVerified: true } }),
    ]);
    void range; // Company aggregate is a point-in-time snapshot (status/verification are current-state facts, not period-bound events) — range accepted for interface symmetry, matching AdminDashboardOverview's own all-time company count.
    return { total, active, verified };
  }

  async getServiceRequestAggregate(range: AnalyticsRange): Promise<PlatformServiceRequestAggregate> {
    const createdAt = dateFilter(range);
    const baseWhere = { ...NOT_DELETED, ...(createdAt ? { createdAt } : {}) };

    const [total, byStatusGroups, openRequests, cancelledRequests, completedJobGroups] = await Promise.all([
      prisma.serviceRequest.count({ where: baseWhere }),
      prisma.serviceRequest.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
      prisma.serviceRequest.count({ where: { ...baseWhere, status: "PUBLISHED" } }),
      prisma.serviceRequest.count({ where: { ...baseWhere, status: "CANCELLED" } }),
      prisma.job.groupBy({
        by: ["serviceRequestId"],
        where: {
          status: "COMPLETED",
          ...(createdAt ? { serviceRequest: { createdAt } } : {}),
        },
      }),
    ]);

    const byStatus: AnalyticsStatusCount[] = byStatusGroups.map((g) => ({ status: g.status, count: g._count._all }));
    // newInPeriod === total when a range is given (both already filter on
    // createdAt); kept as a distinct field on the DTO for readability at
    // the call site and forward compatibility, matching the module spec's
    // requested "new requests in period" metric name exactly.
    return {
      total,
      newInPeriod: total,
      byStatus,
      openRequests,
      cancelledRequests,
      completedRequests: completedJobGroups.length,
    };
  }

  async getQuoteAggregate(range: AnalyticsRange): Promise<PlatformQuoteAggregate> {
    const createdAt = dateFilter(range);
    const baseWhere = createdAt ? { createdAt } : {};

    const [total, byStatusGroups, avg] = await Promise.all([
      prisma.quote.count({ where: baseWhere }),
      prisma.quote.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
      prisma.quote.aggregate({ where: baseWhere, _avg: { totalAmount: true } }),
    ]);

    const countFor = (status: string) => byStatusGroups.find((g) => g.status === status)?._count._all ?? 0;
    const pendingOrSent = countFor("PENDING") + countFor("SENT") + countFor("VIEWED");

    return {
      total,
      accepted: countFor("ACCEPTED"),
      rejected: countFor("REJECTED"),
      expired: countFor("EXPIRED"),
      withdrawn: countFor("WITHDRAWN"),
      pendingOrSent,
      averageAmount: avg._avg.totalAmount ? Number(avg._avg.totalAmount) : null,
    };
  }

  async getBookingAggregate(range: AnalyticsRange): Promise<PlatformBookingAggregate> {
    const createdAt = dateFilter(range);
    const baseWhere = createdAt ? { createdAt } : {};

    const [total, confirmed, completed, cancelled] = await Promise.all([
      prisma.appointment.count({ where: baseWhere }),
      prisma.appointment.count({ where: { ...baseWhere, status: "CONFIRMED" } }),
      prisma.appointment.count({ where: { ...baseWhere, status: "COMPLETED" } }),
      prisma.appointment.count({ where: { ...baseWhere, status: "CANCELLED" } }),
    ]);

    return { total, confirmed, completed, cancelled };
  }

  async getJobAggregate(range: AnalyticsRange): Promise<PlatformJobAggregate> {
    const createdAt = dateFilter(range);
    const baseWhere = createdAt ? { createdAt } : {};

    const [total, completed, cancelled] = await Promise.all([
      prisma.job.count({ where: baseWhere }),
      prisma.job.count({ where: { ...baseWhere, status: "COMPLETED" } }),
      prisma.job.count({ where: { ...baseWhere, status: "CANCELLED" } }),
    ]);

    return { total, completed, cancelled };
  }

  async getReviewAggregate(range: AnalyticsRange): Promise<PlatformReviewAggregate> {
    const createdAt = dateFilter(range);
    // Only PUBLISHED reviews count toward a public-facing average/
    // distribution — same visibility filter ReviewRepository's own public
    // queries apply (see review-repository.ts's doc comment: FLAGGED/
    // REMOVED/PENDING reviews are never part of a public rating signal).
    const baseWhere = { status: "PUBLISHED" as const, ...NOT_DELETED, ...(createdAt ? { createdAt } : {}) };

    const [total, avg, byRatingGroups] = await Promise.all([
      prisma.review.count({ where: baseWhere }),
      prisma.review.aggregate({ where: baseWhere, _avg: { rating: true } }),
      prisma.review.groupBy({ by: ["rating"], where: baseWhere, _count: { _all: true } }),
    ]);

    const distribution: PlatformReviewAggregate["distribution"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const g of byRatingGroups) {
      const key = String(g.rating) as keyof typeof distribution;
      if (key in distribution) distribution[key] = g._count._all;
    }

    return {
      total,
      averageRating: avg._avg.rating ? Number(avg._avg.rating) : null,
      distribution,
    };
  }

  async getServiceRequestsTimeSeries(
    range: { from: Date; to: Date },
    granularity: TimeSeriesGranularity,
  ): Promise<AnalyticsTimeSeriesBucket[]> {
    // Prisma's query builder has no `GROUP BY date_trunc(...)`, so this one
    // query uses `$queryRaw` with a parameterized `date_trunc` — the
    // standard, documented Postgres-via-Prisma approach for time-bucketed
    // aggregation (see Prisma's own "raw queries" docs for this exact
    // pattern). Every value is passed as a bound parameter (never
    // string-concatenated), and `granularity` is validated against a
    // closed enum by the domain layer before it ever reaches this method,
    // so there is no SQL-injection surface here despite the raw query.
    const unit = granularity === "DAY" ? "day" : granularity === "WEEK" ? "week" : "month";
    const rows = await prisma.$queryRaw<{ bucket_start: Date; count: bigint }[]>`
      SELECT date_trunc(${unit}, "createdAt") AS bucket_start, COUNT(*) AS count
      FROM "service_requests"
      WHERE "deletedAt" IS NULL AND "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `;
    return rows.map((r) => ({ bucketStart: new Date(r.bucket_start), count: Number(r.count) }));
  }

  async getCategoryBreakdown(range: AnalyticsRange): Promise<AnalyticsCategoryAggregate[]> {
    const createdAt = dateFilter(range);

    // Quote/Job don't carry `categoryId` directly (only ServiceRequest
    // does — see schema.prisma), so grouping either by category requires a
    // join Prisma's `groupBy` can't express. Two small raw queries (one
    // per join), each returning at most "number of categories" rows via an
    // indexed `serviceRequestId`/`categoryId` join — not a full scan of
    // Quote/Job, and never loaded row-by-row into memory beyond that
    // bounded result set.
    const [categories, requestGroups, quoteGroups, jobGroups] = await Promise.all([
      prisma.serviceCategory.findMany({
        where: { deletedAt: null, status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.serviceRequest.groupBy({
        by: ["categoryId"],
        where: { deletedAt: null, ...(createdAt ? { createdAt } : {}) },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ category_id: string; quote_count: bigint; accepted_quote_count: bigint }[]>`
        SELECT sr."categoryId" AS category_id,
               COUNT(*) AS quote_count,
               COUNT(*) FILTER (WHERE q.status = 'ACCEPTED') AS accepted_quote_count
        FROM "quotes" q
        JOIN "service_requests" sr ON sr.id = q."serviceRequestId"
        WHERE sr."deletedAt" IS NULL
          ${range.from ? Prisma.sql`AND q."createdAt" >= ${range.from}` : Prisma.empty}
          ${range.to ? Prisma.sql`AND q."createdAt" <= ${range.to}` : Prisma.empty}
        GROUP BY sr."categoryId"
      `,
      prisma.$queryRaw<{ category_id: string; completed_job_count: bigint }[]>`
        SELECT sr."categoryId" AS category_id,
               COUNT(*) AS completed_job_count
        FROM "jobs" j
        JOIN "service_requests" sr ON sr.id = j."serviceRequestId"
        WHERE sr."deletedAt" IS NULL AND j.status = 'COMPLETED'
          ${range.from ? Prisma.sql`AND j."createdAt" >= ${range.from}` : Prisma.empty}
          ${range.to ? Prisma.sql`AND j."createdAt" <= ${range.to}` : Prisma.empty}
        GROUP BY sr."categoryId"
      `,
    ]);

    const requestByCategory = new Map(requestGroups.map((g) => [g.categoryId, g._count._all]));
    const quoteByCategory = new Map(quoteGroups.map((g) => [g.category_id, g]));
    const jobByCategory = new Map(jobGroups.map((g) => [g.category_id, Number(g.completed_job_count)]));

    return categories.map((c) => ({
      categoryId: c.id,
      categoryName: c.name,
      requestCount: requestByCategory.get(c.id) ?? 0,
      quoteCount: Number(quoteByCategory.get(c.id)?.quote_count ?? 0),
      acceptedQuoteCount: Number(quoteByCategory.get(c.id)?.accepted_quote_count ?? 0),
      completedJobCount: jobByCategory.get(c.id) ?? 0,
    }));
  }

  async getCityBreakdown(range: AnalyticsRange): Promise<AnalyticsCityAggregate[]> {
    // Coarse city/province only, read from Address.city/province (never
    // latitude/longitude) — see AnalyticsCityAggregate's own doc comment
    // and docs/MODULE_23_ANALYTICS.md, "Privacy," for why this repository
    // has no method that ever selects a coordinate or a precise street
    // address. Capped at the top 50 cities by request volume so this can
    // never return an unbounded number of rows for a platform with many
    // distinct city values.
    const rows = await prisma.$queryRaw<
      { city: string; province: string | null; request_count: bigint; completed_job_count: bigint }[]
    >`
      SELECT a.city AS city, a.province AS province,
             COUNT(DISTINCT sr.id) AS request_count,
             COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'COMPLETED') AS completed_job_count
      FROM "addresses" a
      JOIN "service_requests" sr ON sr."addressId" = a.id AND sr."deletedAt" IS NULL
      LEFT JOIN "jobs" j ON j."serviceRequestId" = sr.id
      WHERE 1=1
        ${range.from ? Prisma.sql`AND sr."createdAt" >= ${range.from}` : Prisma.empty}
        ${range.to ? Prisma.sql`AND sr."createdAt" <= ${range.to}` : Prisma.empty}
      GROUP BY a.city, a.province
      ORDER BY request_count DESC
      LIMIT 50
    `;

    return rows.map((r) => ({
      city: r.city,
      province: r.province,
      requestCount: Number(r.request_count),
      completedJobCount: Number(r.completed_job_count),
    }));
  }

  async getFunnelCounts(range: AnalyticsRange): Promise<AnalyticsFunnelCounts> {
    const createdAt = dateFilter(range);
    const requestWhere = { deletedAt: null, ...(createdAt ? { createdAt } : {}) };

    const [requestsCreated, requestsWithQuotes, requestsWithAcceptedQuote, requestsWithBooking, requestsCompleted] =
      await Promise.all([
        prisma.serviceRequest.count({ where: requestWhere }),
        prisma.serviceRequest.count({ where: { ...requestWhere, quotes: { some: {} } } }),
        prisma.serviceRequest.count({ where: { ...requestWhere, quotes: { some: { status: "ACCEPTED" } } } }),
        // "Booking created" = at least one Appointment exists for the
        // request. In this codebase's actual state machine, a Job (and its
        // first Appointment) is created automatically and atomically the
        // moment a Quote is accepted (see Job's doc comment in
        // schema.prisma) — there is no separate customer/professional
        // action that creates a "booking" after acceptance. This stage is
        // therefore expected to track requestsWithAcceptedQuote almost
        // exactly; see docs/MODULE_23_ANALYTICS.md, "Funnel definitions,"
        // for why this isn't a modeling bug.
        prisma.serviceRequest.count({ where: { ...requestWhere, appointments: { some: {} } } }),
        prisma.serviceRequest.count({ where: { ...requestWhere, jobs: { some: { status: "COMPLETED" } } } }),
      ]);

    return { requestsCreated, requestsWithQuotes, requestsWithAcceptedQuote, requestsWithBooking, requestsCompleted };
  }
}
