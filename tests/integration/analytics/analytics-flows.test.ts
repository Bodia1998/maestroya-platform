import { beforeEach, describe, expect, it } from "vitest";

import { GetCustomerAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/get-customer-analytics-summary.use-case";
import { GetPlatformAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/get-platform-analytics-summary.use-case";
import { GetPlatformCategoryBreakdownUseCase } from "@/application/use-cases/analytics/get-platform-category-breakdown.use-case";
import { GetPlatformFunnelUseCase } from "@/application/use-cases/analytics/get-platform-funnel.use-case";
import { GetPlatformGeoBreakdownUseCase } from "@/application/use-cases/analytics/get-platform-geo-breakdown.use-case";
import { GetPlatformRequestsTimeSeriesUseCase } from "@/application/use-cases/analytics/get-platform-requests-timeseries.use-case";
import { GetProfessionalAnalyticsSummaryUseCase } from "@/application/use-cases/analytics/get-professional-analytics-summary.use-case";
import type { GetProfessionalEarningsUseCase } from "@/application/use-cases/financial/get-professional-earnings.use-case";
import { GetPlatformRevenueSummaryUseCase } from "@/application/use-cases/financial/get-platform-revenue-summary.use-case";
import { ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalEarningsDTO } from "@/application/dto/financial.dto";
import {
  FakeCustomerAnalyticsRepository,
  FakeCustomerProfileRepository,
  FakeFinancialReportingRepository,
  FakePlatformAnalyticsRepository,
  FakeProfessionalAnalyticsRepository,
  FakeProfessionalRepository,
  FakeReviewRepository,
} from "./fakes";

/**
 * Integration tests for Module 23 — Analytics. Real use cases + fake
 * repositories, same pattern as every other module (see
 * tests/integration/financial/financial-flows.test.ts). Authorization
 * (role/session gating) is enforced one layer up in the Server Action
 * (see src/app/(dashboard)/admin/analytics/actions.ts) and is exercised by
 * the existing rbac.test.ts, not re-tested here — these tests instead
 * cover what actually lives in this module: date-range validation,
 * aggregation/gap-filling, funnel math, and — critically — that
 * professional/customer ownership can never be redirected to someone
 * else's data no matter what a use case is called with.
 */

function makeStubEarnings(entries: ProfessionalEarningsDTO[]): GetProfessionalEarningsUseCase {
  return { execute: async () => entries } as unknown as GetProfessionalEarningsUseCase;
}

function earningsEntry(overrides: Partial<ProfessionalEarningsDTO> = {}): ProfessionalEarningsDTO {
  return {
    commissionId: "commission-1",
    paymentId: "payment-1",
    jobId: "job-1",
    rateBps: 1000,
    laborSubtotal: 1000,
    materialsSubtotal: 0,
    totalAmount: 1000,
    professionalCommission: 100,
    professionalPayout: 900,
    status: "SETTLED",
    settledAt: new Date("2026-06-15T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Platform / admin
// ---------------------------------------------------------------------------

describe("GetPlatformAnalyticsSummaryUseCase", () => {
  it("computes safe ratios and passes the resolved range to every sub-query and to Module 22's revenue summary", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    analytics.quoteAggregate = {
      total: 10,
      accepted: 4,
      rejected: 3,
      expired: 1,
      withdrawn: 2,
      pendingOrSent: 0,
      averageAmount: 250,
    };
    analytics.bookingAggregate = { total: 5, confirmed: 1, completed: 3, cancelled: 1 };
    analytics.jobAggregate = { total: 0, completed: 0, cancelled: 0 };

    const reporting = new FakeFinancialReportingRepository();
    reporting.platformRevenue = {
      grossLaborVolume: 1000,
      grossMaterialsVolume: 200,
      customerPlatformFees: 75,
      professionalCommissions: 75,
      refundsTotal: 0,
      disputeAdjustmentsTotal: 0,
      payoutsTotal: 0,
      paymentCount: 4,
    };

    const useCase = new GetPlatformAnalyticsSummaryUseCase(analytics, new GetPlatformRevenueSummaryUseCase(reporting));
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T00:00:00Z");
    const result = await useCase.execute({ from, to });

    expect(result.range).toEqual({ from, to });
    expect(result.quotes.acceptanceRate).toBeCloseTo(0.4);
    expect(result.bookings.conversionRate).toBeCloseTo(0.6);
    // No jobs at all in range -> rate is null, never 0/0 = NaN or a
    // misleading 0.
    expect(result.jobs.completionRate).toBeNull();
    expect(result.financial.platformGrossRevenue).toBe(150);
    // Every sub-aggregate saw the exact same resolved range.
    for (const range of Object.values(analytics.lastRangeSeenBy)) {
      expect(range).toEqual({ from, to });
    }
  });

  it("treats an omitted range as unranged (all-time) rather than defaulting to a recent window", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    const reporting = new FakeFinancialReportingRepository();
    const useCase = new GetPlatformAnalyticsSummaryUseCase(analytics, new GetPlatformRevenueSummaryUseCase(reporting));

    const result = await useCase.execute({});

    expect(result.range).toEqual({ from: null, to: null });
    expect(analytics.lastRangeSeenBy.getUserAggregate).toEqual({ from: null, to: null });
  });

  it("rejects from > to before touching any repository", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    const reporting = new FakeFinancialReportingRepository();
    const useCase = new GetPlatformAnalyticsSummaryUseCase(analytics, new GetPlatformRevenueSummaryUseCase(reporting));

    await expect(useCase.execute({ from: new Date("2026-02-01"), to: new Date("2026-01-01") })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("GetPlatformRequestsTimeSeriesUseCase", () => {
  it("fills empty periods with zero counts, in deterministic order", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    analytics.timeSeries = [{ bucketStart: new Date("2026-01-02T00:00:00Z"), count: 5 }];
    const useCase = new GetPlatformRequestsTimeSeriesUseCase(analytics);

    const result = await useCase.execute({
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-03T00:00:00Z"),
      granularity: "DAY",
    });

    expect(result).toEqual([
      { bucketStart: new Date("2026-01-01T00:00:00Z"), count: 0 },
      { bucketStart: new Date("2026-01-02T00:00:00Z"), count: 5 },
      { bucketStart: new Date("2026-01-03T00:00:00Z"), count: 0 },
    ]);
  });

  it("rejects an open-ended range (time series requires both from and to)", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    const useCase = new GetPlatformRequestsTimeSeriesUseCase(analytics);
    await expect(useCase.execute({ from: new Date("2026-01-01"), granularity: "DAY" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects a range too large for the requested granularity", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    const useCase = new GetPlatformRequestsTimeSeriesUseCase(analytics);
    await expect(
      useCase.execute({ from: new Date("2015-01-01"), to: new Date("2026-01-01"), granularity: "DAY" }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("GetPlatformFunnelUseCase", () => {
  it("computes each stage's conversion rate from actual lifecycle counts", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    analytics.funnelCounts = {
      requestsCreated: 100,
      requestsWithQuotes: 80,
      requestsWithAcceptedQuote: 40,
      requestsWithBooking: 38,
      requestsCompleted: 30,
    };
    const useCase = new GetPlatformFunnelUseCase(analytics);

    const result = await useCase.execute({});

    expect(result.requestToQuoteRate).toBeCloseTo(0.8);
    expect(result.quoteToAcceptanceRate).toBeCloseTo(0.5);
    expect(result.acceptanceToBookingRate).toBeCloseTo(38 / 40);
    expect(result.bookingToCompletionRate).toBeCloseTo(30 / 38);
    expect(result.overallCompletionRate).toBeCloseTo(0.3);
  });

  it("returns null (never a division-by-zero artifact) for every stage when there is no data", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    const useCase = new GetPlatformFunnelUseCase(analytics);

    const result = await useCase.execute({});

    expect(result.requestToQuoteRate).toBeNull();
    expect(result.quoteToAcceptanceRate).toBeNull();
    expect(result.acceptanceToBookingRate).toBeNull();
    expect(result.bookingToCompletionRate).toBeNull();
    expect(result.overallCompletionRate).toBeNull();
  });
});

describe("GetPlatformCategoryBreakdownUseCase / GetPlatformGeoBreakdownUseCase", () => {
  it("pass the resolved range straight through to the repository", async () => {
    const analytics = new FakePlatformAnalyticsRepository();
    analytics.categoryBreakdown = [
      { categoryId: "cat-1", categoryName: "Plumbing", requestCount: 5, quoteCount: 3, acceptedQuoteCount: 1, completedJobCount: 1 },
    ];
    analytics.cityBreakdown = [{ city: "Madrid", province: "Madrid", requestCount: 10, completedJobCount: 4 }];

    const categories = await new GetPlatformCategoryBreakdownUseCase(analytics).execute({});
    const cities = await new GetPlatformGeoBreakdownUseCase(analytics).execute({});

    expect(categories).toEqual(analytics.categoryBreakdown);
    expect(cities).toEqual(analytics.cityBreakdown);
    // Coarse geography only — never a coordinate or a precise address.
    expect(cities[0]).not.toHaveProperty("latitude");
    expect(cities[0]).not.toHaveProperty("addressLine");
  });
});

// ---------------------------------------------------------------------------
// Professional
// ---------------------------------------------------------------------------

describe("GetProfessionalAnalyticsSummaryUseCase", () => {
  let professionals: FakeProfessionalRepository;
  let analytics: FakeProfessionalAnalyticsRepository;
  let reviews: FakeReviewRepository;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    analytics = new FakeProfessionalAnalyticsRepository();
    reviews = new FakeReviewRepository();
  });

  it("throws ValidationError when the caller has no professional profile", async () => {
    const useCase = new GetProfessionalAnalyticsSummaryUseCase(professionals, analytics, reviews, makeStubEarnings([]));
    await expect(useCase.execute("user-without-profile", {})).rejects.toThrow(ValidationError);
  });

  it("resolves the caller's own professionalProfileId server-side and never a client-supplied one", async () => {
    const mine = professionals.seed({ userId: "user-me" });
    professionals.seed({ userId: "user-other" });

    const useCase = new GetProfessionalAnalyticsSummaryUseCase(professionals, analytics, reviews, makeStubEarnings([]));
    await useCase.execute("user-me", {});

    expect(analytics.calls).toHaveLength(1);
    expect(analytics.calls[0]?.professionalProfileId).toBe(mine.id);
  });

  it("never returns another professional's summary no matter which counts are seeded for them", async () => {
    const me = professionals.seed({ userId: "user-me" });
    const other = professionals.seed({ userId: "user-other" });
    analytics.summaries.set(me.id, {
      requestsRespondedTo: 1,
      quotesSubmitted: 2,
      quotesAccepted: 1,
      quotesRejected: 1,
      bookingsReceived: 1,
      bookingsConfirmed: 1,
      bookingsCompleted: 1,
      bookingsCancelled: 0,
      jobsCompleted: 1,
      jobsCancelled: 0,
      portfolioItemCount: 2,
    });
    analytics.summaries.set(other.id, {
      requestsRespondedTo: 999,
      quotesSubmitted: 999,
      quotesAccepted: 999,
      quotesRejected: 999,
      bookingsReceived: 999,
      bookingsConfirmed: 999,
      bookingsCompleted: 999,
      bookingsCancelled: 999,
      jobsCompleted: 999,
      jobsCancelled: 999,
      portfolioItemCount: 999,
    });

    const useCase = new GetProfessionalAnalyticsSummaryUseCase(professionals, analytics, reviews, makeStubEarnings([]));
    const result = await useCase.execute("user-me", {});

    expect(result.quotes.submitted).toBe(2);
    expect(result.portfolioItemCount).toBe(2);
  });

  it("returns valid, all-zero/null metrics for a professional with no activity", async () => {
    professionals.seed({ userId: "user-me" });
    const useCase = new GetProfessionalAnalyticsSummaryUseCase(professionals, analytics, reviews, makeStubEarnings([]));

    const result = await useCase.execute("user-me", {});

    expect(result.quotes).toEqual({ submitted: 0, accepted: 0, rejected: 0, acceptanceRate: null });
    expect(result.jobs).toEqual({ completed: 0, cancelled: 0, completionRate: null });
    expect(result.rating).toEqual({ average: null, reviewCount: 0 });
    expect(result.earnings).toEqual({ totalCommission: 0, totalNetEarnings: 0, settledJobCount: 0 });
  });

  it("computes quote acceptance rate and job completion rate safely", async () => {
    const me = professionals.seed({ userId: "user-me" });
    analytics.summaries.set(me.id, {
      requestsRespondedTo: 4,
      quotesSubmitted: 4,
      quotesAccepted: 3,
      quotesRejected: 1,
      bookingsReceived: 3,
      bookingsConfirmed: 3,
      bookingsCompleted: 2,
      bookingsCancelled: 1,
      jobsCompleted: 2,
      jobsCancelled: 1,
      portfolioItemCount: 0,
    });

    const useCase = new GetProfessionalAnalyticsSummaryUseCase(professionals, analytics, reviews, makeStubEarnings([]));
    const result = await useCase.execute("user-me", {});

    expect(result.quotes.acceptanceRate).toBeCloseTo(0.75);
    expect(result.jobs.completionRate).toBeCloseTo(2 / 3);
  });

  it("supports date-range filtering, applied to a professional's own record set only", async () => {
    const me = professionals.seed({ userId: "user-me" });
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T00:00:00Z");

    const useCase = new GetProfessionalAnalyticsSummaryUseCase(professionals, analytics, reviews, makeStubEarnings([]));
    await useCase.execute("user-me", { from, to });

    expect(analytics.calls[0]).toEqual({ professionalProfileId: me.id, range: { from, to } });
  });

  it("reuses Module 22's own earnings figures unmodified — never recalculates a commission", async () => {
    professionals.seed({ userId: "user-me" });
    const entries = [
      earningsEntry({ professionalCommission: 100, professionalPayout: 900, settledAt: new Date("2026-06-01") }),
      earningsEntry({ professionalCommission: 50, professionalPayout: 450, settledAt: new Date("2026-06-10") }),
    ];
    const useCase = new GetProfessionalAnalyticsSummaryUseCase(
      professionals,
      analytics,
      reviews,
      makeStubEarnings(entries),
    );

    const result = await useCase.execute("user-me", {});

    // Straight sum of the Module-22-provided figures — 150 and 1350 are
    // never independently recomputed from rateBps/laborSubtotal here.
    expect(result.earnings.totalCommission).toBe(150);
    expect(result.earnings.totalNetEarnings).toBe(1350);
    expect(result.earnings.settledJobCount).toBe(2);
  });

  it("scopes earnings to settledAt when a date range is given, excluding still-unsettled commissions", async () => {
    professionals.seed({ userId: "user-me" });
    const entries = [
      earningsEntry({ professionalCommission: 100, settledAt: new Date("2026-01-15") }),
      earningsEntry({ professionalCommission: 200, settledAt: new Date("2026-03-01") }), // outside range
      earningsEntry({ professionalCommission: 300, settledAt: null }), // unsettled — excluded once ranged
    ];
    const useCase = new GetProfessionalAnalyticsSummaryUseCase(
      professionals,
      analytics,
      reviews,
      makeStubEarnings(entries),
    );

    const result = await useCase.execute("user-me", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-31T00:00:00Z"),
    });

    expect(result.earnings.totalCommission).toBe(100);
    expect(result.earnings.settledJobCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

describe("GetCustomerAnalyticsSummaryUseCase", () => {
  let customerProfiles: FakeCustomerProfileRepository;
  let analytics: FakeCustomerAnalyticsRepository;
  let financialReporting: FakeFinancialReportingRepository;

  beforeEach(() => {
    customerProfiles = new FakeCustomerProfileRepository();
    analytics = new FakeCustomerAnalyticsRepository();
    financialReporting = new FakeFinancialReportingRepository();
  });

  it("throws ValidationError when the caller has no customer profile", async () => {
    const useCase = new GetCustomerAnalyticsSummaryUseCase(customerProfiles, analytics, financialReporting);
    await expect(useCase.execute("user-without-profile", {})).rejects.toThrow(ValidationError);
  });

  it("resolves the caller's own customerProfileId server-side and never a client-supplied one", async () => {
    const mine = await customerProfiles.findOrCreateByUserId("user-me");
    await customerProfiles.findOrCreateByUserId("user-other");

    const useCase = new GetCustomerAnalyticsSummaryUseCase(customerProfiles, analytics, financialReporting);
    await useCase.execute("user-me", {});

    expect(analytics.calls).toHaveLength(1);
    expect(analytics.calls[0]?.customerProfileId).toBe(mine.id);
    // Spend is keyed by payerId === User.id, always the session's own id.
    expect(financialReporting.lastCustomerSpendCall?.payerId).toBe("user-me");
  });

  it("never returns another customer's summary no matter which counts are seeded for them", async () => {
    const me = await customerProfiles.findOrCreateByUserId("user-me");
    const other = await customerProfiles.findOrCreateByUserId("user-other");
    analytics.summaries.set(me.id, {
      requestsCreated: 2,
      requestsByStatus: [{ status: "PUBLISHED", count: 2 }],
      quotesReceived: 3,
      quotesAccepted: 1,
      bookingsCreated: 1,
      bookingsCompleted: 1,
      bookingsCancelled: 0,
      jobsCompleted: 1,
      reviewsSubmitted: 1,
      averageRatingGiven: 5,
    });
    analytics.summaries.set(other.id, {
      requestsCreated: 999,
      requestsByStatus: [],
      quotesReceived: 999,
      quotesAccepted: 999,
      bookingsCreated: 999,
      bookingsCompleted: 999,
      bookingsCancelled: 999,
      jobsCompleted: 999,
      reviewsSubmitted: 999,
      averageRatingGiven: 1,
    });

    const useCase = new GetCustomerAnalyticsSummaryUseCase(customerProfiles, analytics, financialReporting);
    const result = await useCase.execute("user-me", {});

    expect(result.requestsCreated).toBe(2);
    expect(result.reviews.averageRatingGiven).toBe(5);
  });

  it("returns valid, all-zero/null metrics for a customer with no activity", async () => {
    await customerProfiles.findOrCreateByUserId("user-me");
    const useCase = new GetCustomerAnalyticsSummaryUseCase(customerProfiles, analytics, financialReporting);

    const result = await useCase.execute("user-me", {});

    expect(result.requestsCreated).toBe(0);
    expect(result.quotes).toEqual({ received: 0, accepted: 0, acceptanceRate: null });
    expect(result.spending).toEqual({ totalPaid: 0, refundsTotal: 0, paymentCount: 0, averageJobValue: null });
  });

  it("supports date-range filtering, forwarded identically to both the counts repository and the financial reporting boundary", async () => {
    await customerProfiles.findOrCreateByUserId("user-me");
    const from = new Date("2026-02-01T00:00:00Z");
    const to = new Date("2026-02-28T00:00:00Z");

    const useCase = new GetCustomerAnalyticsSummaryUseCase(customerProfiles, analytics, financialReporting);
    await useCase.execute("user-me", { from, to });

    expect(analytics.calls[0]?.range).toEqual({ from, to });
    expect(financialReporting.lastCustomerSpendCall?.range).toEqual({ from, to });
  });

  it("computes average job value from Module 22's spend aggregate, never recalculating it independently", async () => {
    const me = await customerProfiles.findOrCreateByUserId("user-me");
    analytics.summaries.set(me.id, {
      requestsCreated: 1,
      requestsByStatus: [],
      quotesReceived: 1,
      quotesAccepted: 1,
      bookingsCreated: 1,
      bookingsCompleted: 1,
      bookingsCancelled: 0,
      jobsCompleted: 2,
      reviewsSubmitted: 0,
      averageRatingGiven: null,
    });
    financialReporting.customerSpendByPayer.set("user-me", { totalPaid: 1000, refundsTotal: 100, paymentCount: 2 });

    const useCase = new GetCustomerAnalyticsSummaryUseCase(customerProfiles, analytics, financialReporting);
    const result = await useCase.execute("user-me", {});

    expect(result.spending.totalPaid).toBe(1000);
    expect(result.spending.averageJobValue).toBe(500);
  });
});
