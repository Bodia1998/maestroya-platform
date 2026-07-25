import type { TimeSeriesGranularity } from "@/domain/services/analytics-date-range";

/**
 * Module 23 — Analytics: read-only reporting repository interfaces.
 *
 * Why a new set of repositories instead of reusing the existing ones
 * (ServiceRequestRepository, QuoteRepository, AppointmentRepository,
 * JobRepository, ReviewRepository, ProfessionalRepository, ...): every one
 * of those is scoped to its own module's transactional needs (find one
 * record, list a caller's own records, mutate a status) and none of them
 * expose grouped counts/sums/averages across a date range — adding those
 * methods there would blur "repository for module N's business
 * operations" with "repository for cross-cutting reporting," which is
 * exactly the mixing of concerns the Admin Panel module's own
 * AdminRepository doc comment already warns against for a different pair
 * of concerns. Following that same precedent (one broad, purpose-built
 * interface for an oversight/reporting layer, not eight near-duplicate
 * narrow ones), this module gets three narrow-per-audience but broad-per-
 * query interfaces instead.
 *
 * These interfaces are query-only by construction — there is no mutating
 * method on any of them, and none ever will be (see docs/
 * MODULE_23_ANALYTICS.md, "Architecture: read-only by construction"). They
 * never duplicate a business rule already owned by another module: every
 * financial figure is instead obtained by calling into Module 22's own
 * use cases/reporting repository (see application/use-cases/analytics),
 * and every status/enum value returned here is read verbatim from the
 * column another module already writes — this file introduces no new
 * lifecycle states.
 */

// ---------------------------------------------------------------------------
// Shared aggregate shapes
// ---------------------------------------------------------------------------

export interface AnalyticsRange {
  from: Date | null;
  to: Date | null;
}

export interface AnalyticsStatusCount {
  status: string;
  count: number;
}

export interface AnalyticsTimeSeriesBucket {
  bucketStart: Date;
  count: number;
}

export interface AnalyticsCategoryAggregate {
  categoryId: string;
  categoryName: string;
  requestCount: number;
  quoteCount: number;
  acceptedQuoteCount: number;
  completedJobCount: number;
}

/** Coarse geography only — city/province, never a precise address or
 *  coordinate pair. See docs/MODULE_23_ANALYTICS.md, "Privacy." */
export interface AnalyticsCityAggregate {
  city: string;
  province: string | null;
  requestCount: number;
  completedJobCount: number;
}

export interface AnalyticsFunnelCounts {
  requestsCreated: number;
  requestsWithQuotes: number;
  requestsWithAcceptedQuote: number;
  requestsWithBooking: number;
  requestsCompleted: number;
}

// ---------------------------------------------------------------------------
// Platform / admin
// ---------------------------------------------------------------------------

export interface PlatformUserAggregate {
  totalUsers: number;
  newUsers: number;
  /** Users with `lastLoginAt` inside the requested range (or, for an
   *  unranged query, inside the trailing 30 days from now — see
   *  GetPlatformAnalyticsSummaryUseCase's own doc comment for why an
   *  unranged "active" figure still needs *some* window to be meaningful
   *  at all). */
  activeUsers: number;
  customers: number;
  professionals: number;
  companies: number;
}

export interface PlatformProfessionalAggregate {
  total: number;
  active: number;
  verified: number;
  newlyRegistered: number;
  withCompletedJobs: number;
}

export interface PlatformCompanyAggregate {
  total: number;
  active: number;
  verified: number;
}

export interface PlatformServiceRequestAggregate {
  total: number;
  newInPeriod: number;
  byStatus: AnalyticsStatusCount[];
  /** ServiceRequestStatus === "PUBLISHED" — still open for quotes/action.
   *  See ServiceRequestStatus's own doc comment in schema.prisma: this
   *  module MVP only ever writes PUBLISHED or CANCELLED, so this is a
   *  faithful read of the real state machine, not an invented one. */
  openRequests: number;
  /** ServiceRequestStatus === "CANCELLED". */
  cancelledRequests: number;
  /** Distinct ServiceRequests with at least one Job whose `status` is
   *  COMPLETED. NOT `ServiceRequestStatus.COMPLETED` — that value is never
   *  written (see JobStatus's doc comment: Job.status is the single
   *  authoritative execution-lifecycle field). */
  completedRequests: number;
}

export interface PlatformQuoteAggregate {
  total: number;
  accepted: number;
  rejected: number;
  expired: number;
  withdrawn: number;
  pendingOrSent: number;
  /** Average of `totalAmount` across every quote in range, in the
   *  platform's default currency unit (EUR, matching Quote.currency's
   *  default) — null when there are no quotes in range. */
  averageAmount: number | null;
}

export interface PlatformBookingAggregate {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
}

export interface PlatformJobAggregate {
  total: number;
  completed: number;
  cancelled: number;
}

export interface PlatformReviewAggregate {
  total: number;
  averageRating: number | null;
  /** Keyed "1".."5" — always present with 0 for ratings that didn't occur,
   *  so a consumer never needs to special-case a missing key. */
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface PlatformAnalyticsRepository {
  getUserAggregate(range: AnalyticsRange): Promise<PlatformUserAggregate>;
  getProfessionalAggregate(range: AnalyticsRange): Promise<PlatformProfessionalAggregate>;
  getCompanyAggregate(range: AnalyticsRange): Promise<PlatformCompanyAggregate>;
  getServiceRequestAggregate(range: AnalyticsRange): Promise<PlatformServiceRequestAggregate>;
  getQuoteAggregate(range: AnalyticsRange): Promise<PlatformQuoteAggregate>;
  getBookingAggregate(range: AnalyticsRange): Promise<PlatformBookingAggregate>;
  getJobAggregate(range: AnalyticsRange): Promise<PlatformJobAggregate>;
  getReviewAggregate(range: AnalyticsRange): Promise<PlatformReviewAggregate>;
  /** Sparse — only buckets with at least one created ServiceRequest are
   *  returned; the use case fills the gaps (see generateBucketBoundaries). */
  getServiceRequestsTimeSeries(
    range: { from: Date; to: Date },
    granularity: TimeSeriesGranularity,
  ): Promise<AnalyticsTimeSeriesBucket[]>;
  getCategoryBreakdown(range: AnalyticsRange): Promise<AnalyticsCategoryAggregate[]>;
  getCityBreakdown(range: AnalyticsRange): Promise<AnalyticsCityAggregate[]>;
  getFunnelCounts(range: AnalyticsRange): Promise<AnalyticsFunnelCounts>;
}

// ---------------------------------------------------------------------------
// Professional
// ---------------------------------------------------------------------------

export interface ProfessionalAnalyticsSummaryCounts {
  /** Distinct ServiceRequests this professional has submitted at least one
   *  Quote for — "requests received" has no dedicated invitation/lead
   *  concept in this codebase (a professional finds requests via
   *  discovery, see Module 05), so "received" is defined as "responded
   *  to with a quote," the only server-recorded signal available. */
  requestsRespondedTo: number;
  quotesSubmitted: number;
  quotesAccepted: number;
  quotesRejected: number;
  bookingsReceived: number;
  bookingsConfirmed: number;
  bookingsCompleted: number;
  bookingsCancelled: number;
  jobsCompleted: number;
  jobsCancelled: number;
  portfolioItemCount: number;
}

export interface ProfessionalAnalyticsRepository {
  getSummary(professionalProfileId: string, range: AnalyticsRange): Promise<ProfessionalAnalyticsSummaryCounts>;
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export interface CustomerAnalyticsSummaryCounts {
  requestsCreated: number;
  requestsByStatus: AnalyticsStatusCount[];
  quotesReceived: number;
  quotesAccepted: number;
  bookingsCreated: number;
  bookingsCompleted: number;
  bookingsCancelled: number;
  jobsCompleted: number;
  reviewsSubmitted: number;
  /** Average `rating` across reviews this customer authored — null when
   *  they haven't submitted any. */
  averageRatingGiven: number | null;
}

export interface CustomerAnalyticsRepository {
  getSummary(customerProfileId: string, range: AnalyticsRange): Promise<CustomerAnalyticsSummaryCounts>;
}
