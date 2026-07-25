import { z } from "zod";

/**
 * Module 23 — Analytics. Same convention as every other `*.dto.ts` in this
 * codebase: zod schemas validate a Server Action's input, plain interfaces
 * describe the stable, client-safe shape a use case returns. No DTO here
 * ever wraps a raw Prisma model — every field is explicit and was chosen
 * to be safe to show the intended audience (see each summary DTO's own
 * doc comment for exactly what it deliberately omits).
 *
 * Ownership note: none of these schemas accept a `professionalId` or
 * `customerId` — professional/customer analytics are always scoped to the
 * *caller's own* profile, resolved server-side from the authenticated
 * session inside the use case (see GetProfessionalAnalyticsSummaryUseCase/
 * GetCustomerAnalyticsSummaryUseCase), the same "no client-supplied
 * ownership id" convention as GetProfessionalEarningsUseCase/
 * GetCustomerFinancialSummaryUseCase in financial.dto.ts.
 */

// ---------------------------------------------------------------------------
// Date range / aggregation inputs
// ---------------------------------------------------------------------------

export const analyticsDateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from.getTime() <= v.to.getTime(), {
    message: "The start date must be before the end date.",
    path: ["from"],
  });
export type AnalyticsDateRangeInput = z.infer<typeof analyticsDateRangeSchema>;

export const analyticsGranularitySchema = z.enum(["DAY", "WEEK", "MONTH"]);
export type AnalyticsGranularityInput = z.infer<typeof analyticsGranularitySchema>;

export const getAnalyticsTimeSeriesSchema = analyticsDateRangeSchema.and(
  z.object({ granularity: analyticsGranularitySchema.default("DAY") }),
);
export type GetAnalyticsTimeSeriesInput = z.infer<typeof getAnalyticsTimeSeriesSchema>;

/** Echoed back on every summary DTO so a consumer always knows exactly
 *  what window the figures cover, without re-deriving it from the
 *  request. `null` means "unranged" (all-time) — see
 *  analytics-date-range.ts's own doc comment for the full boundary rules. */
export interface AnalyticsDateRangeDTO {
  from: Date | null;
  to: Date | null;
}

export interface AnalyticsStatusBreakdownDTO {
  status: string;
  count: number;
}

export interface AnalyticsTimeSeriesPointDTO {
  bucketStart: Date;
  count: number;
}

export interface AnalyticsCategoryBreakdownDTO {
  categoryId: string;
  categoryName: string;
  requestCount: number;
  quoteCount: number;
  acceptedQuoteCount: number;
  completedJobCount: number;
}

export interface AnalyticsGeoBreakdownDTO {
  city: string;
  province: string | null;
  requestCount: number;
  completedJobCount: number;
}

/**
 * Request Created -> Quotes Received -> Quote Accepted -> Booking Created
 * -> Job Completed, using the exact lifecycle states Modules 06–11 already
 * implement (see AnalyticsFunnelCounts's doc comment on the repository
 * interface — no invented intermediate states). Every `*ConversionRate` is
 * `null`, never `0`, when its denominator is zero (see
 * domain/services/analytics-date-range.ts#safeRatio).
 */
export interface AnalyticsFunnelDTO {
  range: AnalyticsDateRangeDTO;
  requestsCreated: number;
  requestsWithQuotes: number;
  requestsWithAcceptedQuote: number;
  requestsWithBooking: number;
  requestsCompleted: number;
  requestToQuoteRate: number | null;
  quoteToAcceptanceRate: number | null;
  acceptanceToBookingRate: number | null;
  bookingToCompletionRate: number | null;
  overallCompletionRate: number | null;
}

// ---------------------------------------------------------------------------
// Platform / admin summary
// ---------------------------------------------------------------------------

/**
 * Admin-only. Financial figures are exactly Module 22's own
 * `PlatformRevenueSummaryDTO` (see GetPlatformRevenueSummaryUseCase) —
 * this module never recomputes a commission or platform-fee figure, it
 * only re-exposes Module 22's own authoritative numbers alongside the
 * operational counts a financial summary alone doesn't cover.
 */
export interface PlatformAnalyticsSummaryDTO {
  range: AnalyticsDateRangeDTO;
  users: {
    totalUsers: number;
    newUsers: number;
    activeUsers: number;
    customers: number;
    professionals: number;
    companies: number;
  };
  professionals: {
    total: number;
    active: number;
    verified: number;
    newlyRegistered: number;
    withCompletedJobs: number;
  };
  companies: {
    total: number;
    active: number;
    verified: number;
  };
  serviceRequests: {
    total: number;
    newInPeriod: number;
    byStatus: AnalyticsStatusBreakdownDTO[];
    openRequests: number;
    cancelledRequests: number;
    completedRequests: number;
  };
  quotes: {
    total: number;
    accepted: number;
    rejected: number;
    expired: number;
    withdrawn: number;
    pendingOrSent: number;
    averageAmount: number | null;
    /** accepted / total — null when there are no quotes in range. */
    acceptanceRate: number | null;
  };
  bookings: {
    total: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    /** completed / total — null when there are no bookings in range. */
    conversionRate: number | null;
  };
  jobs: {
    total: number;
    completed: number;
    cancelled: number;
    /** completed / total — null when there are no jobs in range. */
    completionRate: number | null;
  };
  reviews: {
    total: number;
    averageRating: number | null;
    distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  };
  /**
   * Module 22's own aggregate, unmodified — see this interface's doc
   * comment. `null` only if the caller isn't authorized to see it (never
   * actually null in practice, since GetPlatformAnalyticsSummaryUseCase
   * unconditionally requests it; kept optional-shaped only so a future
   * caller with narrower financial permissions has a documented way to
   * omit it without a breaking DTO change).
   */
  financial: {
    grossLaborVolume: number;
    grossMaterialsVolume: number;
    customerPlatformFees: number;
    professionalCommissions: number;
    platformGrossRevenue: number;
    refundsTotal: number;
    disputeAdjustmentsTotal: number;
    payoutsTotal: number;
    paymentCount: number;
  };
}

// ---------------------------------------------------------------------------
// Professional summary
// ---------------------------------------------------------------------------

/**
 * Professional-facing. Never includes another professional's data, the
 * customer's platform fee, or the platform's own revenue — see
 * ProfessionalEarningsDTO's doc comment in financial.dto.ts, which this
 * DTO's `earnings` block is built from without modification.
 */
export interface ProfessionalAnalyticsSummaryDTO {
  range: AnalyticsDateRangeDTO;
  requestsRespondedTo: number;
  quotes: {
    submitted: number;
    accepted: number;
    rejected: number;
    /** accepted / submitted — null when nothing was submitted in range. */
    acceptanceRate: number | null;
  };
  bookings: {
    received: number;
    confirmed: number;
    completed: number;
    cancelled: number;
  };
  jobs: {
    completed: number;
    cancelled: number;
    /** completed / (completed + cancelled) — null when neither occurred. */
    completionRate: number | null;
  };
  rating: {
    average: number | null;
    reviewCount: number;
  };
  portfolioItemCount: number;
  earnings: {
    /**
     * Sum of `professionalCommission`/`professionalTotalNetEarnings`
     * across every Module-22 `ProfessionalEarningsDTO` this professional
     * has ever been paid via (see GetProfessionalEarningsUseCase) —
     * Module 23 never recalculates a rate or commission amount itself.
     *
     * Date-range caveat: a commission record has no `createdAt` exposed
     * on ProfessionalEarningsDTO, only `settledAt` (set once payout-ready
     * — see Commission's doc comment in schema.prisma). When a date range
     * is supplied, only *settled* commissions whose `settledAt` falls
     * inside the range are included; unsettled (still-pending) commissions
     * have no settlement date yet and are therefore only ever reflected in
     * the unranged (all-time) query. See docs/MODULE_23_ANALYTICS.md,
     * "Known limitations," for the full explanation.
     */
    totalCommission: number;
    totalNetEarnings: number;
    settledJobCount: number;
  };
}

// ---------------------------------------------------------------------------
// Customer summary
// ---------------------------------------------------------------------------

/**
 * Customer-facing. Never includes the professional's commission/earnings
 * or the platform's own revenue — see CustomerFinancialSummaryDTO's doc
 * comment in financial.dto.ts, which this DTO's `spending` block is built
 * from (via FinancialReportingRepository.getCustomerSpendAggregate, an
 * additive Module 22 reporting method — see that repository's doc
 * comment) without any independent recalculation.
 */
export interface CustomerAnalyticsSummaryDTO {
  range: AnalyticsDateRangeDTO;
  requestsCreated: number;
  requestsByStatus: AnalyticsStatusBreakdownDTO[];
  quotes: {
    received: number;
    accepted: number;
    /** accepted / received — null when no quotes were received. */
    acceptanceRate: number | null;
  };
  bookings: {
    created: number;
    completed: number;
    cancelled: number;
  };
  jobsCompleted: number;
  reviews: {
    submitted: number;
    averageRatingGiven: number | null;
  };
  spending: {
    totalPaid: number;
    refundsTotal: number;
    paymentCount: number;
    /** totalPaid / jobsCompleted — null when no jobs completed in range. */
    averageJobValue: number | null;
  };
}
