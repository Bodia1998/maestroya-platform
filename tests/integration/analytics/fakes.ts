import type {
  AnalyticsCategoryAggregate,
  AnalyticsCityAggregate,
  AnalyticsFunnelCounts,
  AnalyticsRange,
  AnalyticsTimeSeriesBucket,
  CustomerAnalyticsRepository,
  CustomerAnalyticsSummaryCounts,
  PlatformAnalyticsRepository,
  PlatformBookingAggregate,
  PlatformCompanyAggregate,
  PlatformJobAggregate,
  PlatformProfessionalAggregate,
  PlatformQuoteAggregate,
  PlatformReviewAggregate,
  PlatformServiceRequestAggregate,
  PlatformUserAggregate,
  ProfessionalAnalyticsRepository,
  ProfessionalAnalyticsSummaryCounts,
} from "@/domain/repositories/analytics-repository";
import type {
  CustomerProfileRecord,
  CustomerProfileRepository,
} from "@/domain/repositories/customer-profile-repository";
import type {
  CustomerSpendAggregate,
  FinancialReportingRepository,
  PlatformRevenueAggregate,
  PlatformRevenueDateRange,
} from "@/domain/repositories/financial-reporting-repository";
import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
} from "@/domain/repositories/professional-repository";
import type {
  ListProfessionalReviewsOptions,
  ProfessionalRatingSummary,
  ReviewRepository,
} from "@/domain/repositories/review-repository";
import type { TimeSeriesGranularity } from "@/domain/services/analytics-date-range";

/**
 * In-memory test doubles for Module 23 — Analytics integration tests. Same
 * pattern as every other module's tests/integration/<feature>/fakes.ts
 * (see tests/integration/financial/fakes.ts): implement the real domain
 * interfaces so the use cases under test run their genuine orchestration
 * logic, with only storage/query results swapped out. The three analytics
 * repositories are "canned aggregate" fakes rather than real in-memory
 * query engines (unlike, say, FakeReviewRepository's real average-rating
 * computation) — they exist to verify the *use case's* orchestration,
 * validation, and ownership logic, not to re-verify SQL aggregation
 * (which has no equivalent in an in-memory fake and is instead covered by
 * direct inspection of the Prisma repository's queries — see docs/
 * MODULE_23_ANALYTICS.md, "Testing strategy," for why this codebase's own
 * established convention never runs a Prisma repository against a fake
 * DB either).
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Platform analytics repository
// ---------------------------------------------------------------------------

export class FakePlatformAnalyticsRepository implements PlatformAnalyticsRepository {
  userAggregate: PlatformUserAggregate = {
    totalUsers: 0,
    newUsers: 0,
    activeUsers: 0,
    customers: 0,
    professionals: 0,
    companies: 0,
  };
  professionalAggregate: PlatformProfessionalAggregate = {
    total: 0,
    active: 0,
    verified: 0,
    newlyRegistered: 0,
    withCompletedJobs: 0,
  };
  companyAggregate: PlatformCompanyAggregate = { total: 0, active: 0, verified: 0 };
  serviceRequestAggregate: PlatformServiceRequestAggregate = {
    total: 0,
    newInPeriod: 0,
    byStatus: [],
    openRequests: 0,
    cancelledRequests: 0,
    completedRequests: 0,
  };
  quoteAggregate: PlatformQuoteAggregate = {
    total: 0,
    accepted: 0,
    rejected: 0,
    expired: 0,
    withdrawn: 0,
    pendingOrSent: 0,
    averageAmount: null,
  };
  bookingAggregate: PlatformBookingAggregate = { total: 0, confirmed: 0, completed: 0, cancelled: 0 };
  jobAggregate: PlatformJobAggregate = { total: 0, completed: 0, cancelled: 0 };
  reviewAggregate: PlatformReviewAggregate = {
    total: 0,
    averageRating: null,
    distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
  };
  timeSeries: AnalyticsTimeSeriesBucket[] = [];
  categoryBreakdown: AnalyticsCategoryAggregate[] = [];
  cityBreakdown: AnalyticsCityAggregate[] = [];
  funnelCounts: AnalyticsFunnelCounts = {
    requestsCreated: 0,
    requestsWithQuotes: 0,
    requestsWithAcceptedQuote: 0,
    requestsWithBooking: 0,
    requestsCompleted: 0,
  };

  /** Captures the last range each method was called with, so a test can
   *  assert the use case passed the *resolved* range through unmodified. */
  lastRangeSeenBy: Record<string, AnalyticsRange | undefined> = {};

  async getUserAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getUserAggregate = range;
    return this.userAggregate;
  }
  async getProfessionalAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getProfessionalAggregate = range;
    return this.professionalAggregate;
  }
  async getCompanyAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getCompanyAggregate = range;
    return this.companyAggregate;
  }
  async getServiceRequestAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getServiceRequestAggregate = range;
    return this.serviceRequestAggregate;
  }
  async getQuoteAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getQuoteAggregate = range;
    return this.quoteAggregate;
  }
  async getBookingAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getBookingAggregate = range;
    return this.bookingAggregate;
  }
  async getJobAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getJobAggregate = range;
    return this.jobAggregate;
  }
  async getReviewAggregate(range: AnalyticsRange) {
    this.lastRangeSeenBy.getReviewAggregate = range;
    return this.reviewAggregate;
  }
  async getServiceRequestsTimeSeries(_range: { from: Date; to: Date }, _granularity: TimeSeriesGranularity) {
    return this.timeSeries;
  }
  async getCategoryBreakdown(_range: AnalyticsRange) {
    return this.categoryBreakdown;
  }
  async getCityBreakdown(_range: AnalyticsRange) {
    return this.cityBreakdown;
  }
  async getFunnelCounts(_range: AnalyticsRange) {
    return this.funnelCounts;
  }
}

// ---------------------------------------------------------------------------
// Professional analytics repository
// ---------------------------------------------------------------------------

export class FakeProfessionalAnalyticsRepository implements ProfessionalAnalyticsRepository {
  summaries = new Map<string, ProfessionalAnalyticsSummaryCounts>();
  calls: { professionalProfileId: string; range: AnalyticsRange }[] = [];

  private readonly empty: ProfessionalAnalyticsSummaryCounts = {
    requestsRespondedTo: 0,
    quotesSubmitted: 0,
    quotesAccepted: 0,
    quotesRejected: 0,
    bookingsReceived: 0,
    bookingsConfirmed: 0,
    bookingsCompleted: 0,
    bookingsCancelled: 0,
    jobsCompleted: 0,
    jobsCancelled: 0,
    portfolioItemCount: 0,
  };

  async getSummary(professionalProfileId: string, range: AnalyticsRange) {
    this.calls.push({ professionalProfileId, range });
    return this.summaries.get(professionalProfileId) ?? this.empty;
  }
}

// ---------------------------------------------------------------------------
// Customer analytics repository
// ---------------------------------------------------------------------------

export class FakeCustomerAnalyticsRepository implements CustomerAnalyticsRepository {
  summaries = new Map<string, CustomerAnalyticsSummaryCounts>();
  calls: { customerProfileId: string; range: AnalyticsRange }[] = [];

  private readonly empty: CustomerAnalyticsSummaryCounts = {
    requestsCreated: 0,
    requestsByStatus: [],
    quotesReceived: 0,
    quotesAccepted: 0,
    bookingsCreated: 0,
    bookingsCompleted: 0,
    bookingsCancelled: 0,
    jobsCompleted: 0,
    reviewsSubmitted: 0,
    averageRatingGiven: null,
  };

  async getSummary(customerProfileId: string, range: AnalyticsRange) {
    this.calls.push({ customerProfileId, range });
    return this.summaries.get(customerProfileId) ?? this.empty;
  }
}

// ---------------------------------------------------------------------------
// Financial reporting repository (Module 22's own boundary)
// ---------------------------------------------------------------------------

export class FakeFinancialReportingRepository implements FinancialReportingRepository {
  platformRevenue: PlatformRevenueAggregate = {
    grossLaborVolume: 0,
    grossMaterialsVolume: 0,
    customerPlatformFees: 0,
    professionalCommissions: 0,
    refundsTotal: 0,
    disputeAdjustmentsTotal: 0,
    payoutsTotal: 0,
    paymentCount: 0,
  };
  customerSpendByPayer = new Map<string, CustomerSpendAggregate>();
  lastCustomerSpendCall: { payerId: string; range: PlatformRevenueDateRange } | null = null;

  async getPlatformRevenueAggregate(_range: PlatformRevenueDateRange) {
    return this.platformRevenue;
  }

  async getCustomerSpendAggregate(payerId: string, range: PlatformRevenueDateRange) {
    this.lastCustomerSpendCall = { payerId, range };
    return this.customerSpendByPayer.get(payerId) ?? { totalPaid: 0, refundsTotal: 0, paymentCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Professional / customer profile + review repositories
// ---------------------------------------------------------------------------

export class FakeProfessionalRepository implements ProfessionalRepository {
  profiles = new Map<string, ProfessionalRecord>();

  seed(overrides: Partial<ProfessionalRecord> & { userId: string }): ProfessionalRecord {
    const now = new Date();
    const record: ProfessionalRecord = {
      id: nextId("fake-professional"),
      businessName: null,
      bio: null,
      headline: null,
      yearsExperience: null,
      hourlyRate: null,
      serviceRadiusKm: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      taxId: null,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
      isAcceptingRequests: true,
      categoryIds: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.profiles.set(record.id, record);
    return record;
  }

  async findById(id: string) {
    return this.profiles.get(id) ?? null;
  }

  async findByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId) ?? null;
  }

  async create(userId: string, data: CreateProfessionalData): Promise<ProfessionalRecord> {
    return this.seed({ userId, ...data });
  }

  async update(id: string): Promise<ProfessionalRecord> {
    const existing = this.profiles.get(id);
    if (!existing) throw new Error("not found");
    return existing;
  }

  async updateStatus(): Promise<void> {}

  async updateCategories(id: string): Promise<ProfessionalRecord> {
    const existing = this.profiles.get(id);
    if (!existing) throw new Error("not found");
    return existing;
  }
}

export class FakeCustomerProfileRepository implements CustomerProfileRepository {
  profiles = new Map<string, CustomerProfileRecord>();

  async findByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId) ?? null;
  }

  async findById(id: string) {
    return this.profiles.get(id) ?? null;
  }

  async findOrCreateByUserId(userId: string) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;
    const record: CustomerProfileRecord = { id: nextId("fake-customer"), userId };
    this.profiles.set(record.id, record);
    return record;
  }

  // --- Module 88: GDPR Erasure Execution (test stub) ---
  async eraseForUser(_userId: string) {}
}

export class FakeReviewRepository implements ReviewRepository {
  ratingSummaries = new Map<string, ProfessionalRatingSummary>();

  async findById() {
    return null;
  }
  async findByJobId() {
    return null;
  }
  async listByProfessionalId(_professionalProfileId: string, _options: ListProfessionalReviewsOptions) {
    return [];
  }
  async getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    return (
      this.ratingSummaries.get(professionalProfileId) ?? {
        professionalProfileId,
        averageRating: null,
        reviewCount: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        lastReviewAt: null,
      }
    );
  }
  async create(): Promise<never> {
    throw new Error("not used in analytics tests");
  }
  // Module 41 — Reviews & Ratings: not exercised by analytics tests — this
  // fake only ever seeds `ratingSummaries` directly, never a Review row.
  async update(): Promise<never> {
    throw new Error("not used in analytics tests");
  }
  async softDelete(): Promise<never> {
    throw new Error("not used in analytics tests");
  }
  async respond(): Promise<never> {
    throw new Error("not used in analytics tests");
  }
}
