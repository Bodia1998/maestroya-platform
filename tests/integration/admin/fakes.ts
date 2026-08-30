import type {
  AdminAuditAction,
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type {
  AdminCompanyRecord,
  AdminCompanyStatusValue,
  AdminDashboardOverview,
  AdminJobRecord,
  AdminJobStatusValue,
  AdminPortfolioItemRecord,
  AdminProfessionalRecord,
  AdminProfessionalStatusValue,
  AdminQuoteRecord,
  AdminQuoteStatusValue,
  AdminRepository,
  AdminReviewRecord,
  AdminReviewStatusValue,
  AdminServiceRequestRecord,
  AdminServiceRequestStatusValue,
  AdminUserRecord,
  AdminUserStatusValue,
  ListAdminCompaniesOptions,
  ListAdminJobsOptions,
  ListAdminPortfolioItemsOptions,
  ListAdminProfessionalsOptions,
  ListAdminQuotesOptions,
  ListAdminReviewsOptions,
  ListAdminServiceRequestsOptions,
  ListAdminUsersOptions,
} from "@/domain/repositories/admin-repository";

/**
 * In-memory test doubles for the Admin Panel module (Module 16) integration
 * tests — implements the real interfaces so the use cases under test run
 * their genuine orchestration/authorization logic, same pattern as
 * tests/integration/portfolio/fakes.ts / tests/integration/review/fakes.ts.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export const DEFAULT_ROLE_KEYS = ["CUSTOMER", "PROVIDER", "ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR"];

export class FakeAdminRepository implements AdminRepository {
  users = new Map<string, AdminUserRecord>();
  professionals = new Map<string, AdminProfessionalRecord>();
  serviceRequests = new Map<string, AdminServiceRequestRecord>();
  quotes = new Map<string, AdminQuoteRecord>();
  jobs = new Map<string, AdminJobRecord>();
  reviews = new Map<string, AdminReviewRecord>();
  portfolioItems = new Map<string, AdminPortfolioItemRecord>();
  companies = new Map<string, AdminCompanyRecord>();
  roleKeys: string[] = [...DEFAULT_ROLE_KEYS];

  seedCompany(overrides: Partial<AdminCompanyRecord> & { ownerUserId: string }): AdminCompanyRecord {
    const now = new Date();
    const record: AdminCompanyRecord = {
      id: nextId("fake-company"),
      ownerName: "Owner",
      ownerEmail: "owner@example.com",
      legalName: "Acme S.L.",
      tradeName: null,
      taxId: nextId("fake-taxid"),
      status: "ACTIVE",
      isVerified: false,
      memberCount: 1,
      averageRating: null,
      reviewCount: 0,
      createdAt: now,
      ...overrides,
    };
    this.companies.set(record.id, record);
    return record;
  }

  seedUser(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
    const now = new Date();
    const record: AdminUserRecord = {
      id: nextId("fake-user"),
      name: "Test User",
      email: `${nextId("email")}@example.com`,
      phone: null,
      status: "ACTIVE",
      roles: ["CUSTOMER"],
      hasProfessionalProfile: false,
      lastLoginAt: null,
      createdAt: now,
      ...overrides,
    };
    this.users.set(record.id, record);
    return record;
  }

  seedProfessional(overrides: Partial<AdminProfessionalRecord> & { userId: string }): AdminProfessionalRecord {
    const now = new Date();
    const record: AdminProfessionalRecord = {
      id: nextId("fake-professional"),
      userName: "Pro User",
      userEmail: "pro@example.com",
      businessName: null,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      averageRating: null,
      reviewCount: 0,
      portfolioItemCount: 0,
      createdAt: now,
      ...overrides,
    };
    this.professionals.set(record.id, record);
    return record;
  }

  seedServiceRequest(overrides: Partial<AdminServiceRequestRecord> = {}): AdminServiceRequestRecord {
    const now = new Date();
    const record: AdminServiceRequestRecord = {
      id: nextId("fake-request"),
      title: "Fix leaking tap",
      status: "PUBLISHED",
      customerId: nextId("fake-customer-profile"),
      customerUserId: nextId("fake-customer-user"),
      customerName: "Customer",
      quoteCount: 0,
      jobCount: 0,
      createdAt: now,
      ...overrides,
    };
    this.serviceRequests.set(record.id, record);
    return record;
  }

  seedQuote(overrides: Partial<AdminQuoteRecord> = {}): AdminQuoteRecord {
    const now = new Date();
    const record: AdminQuoteRecord = {
      id: nextId("fake-quote"),
      serviceRequestId: nextId("fake-request"),
      serviceRequestTitle: "Fix leaking tap",
      professionalProfileId: null,
      submittedByUserId: nextId("fake-user"),
      status: "PENDING",
      totalAmount: 100,
      currency: "EUR",
      createdAt: now,
      ...overrides,
    };
    this.quotes.set(record.id, record);
    return record;
  }

  seedJob(overrides: Partial<AdminJobRecord> = {}): AdminJobRecord {
    const now = new Date();
    const record: AdminJobRecord = {
      id: nextId("fake-job"),
      serviceRequestId: nextId("fake-request"),
      quoteId: nextId("fake-quote"),
      customerId: nextId("fake-customer-profile"),
      professionalProfileId: null,
      status: "CREATED",
      appointmentCount: 0,
      createdAt: now,
      ...overrides,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  seedReview(overrides: Partial<AdminReviewRecord> = {}): AdminReviewRecord {
    const now = new Date();
    const record: AdminReviewRecord = {
      id: nextId("fake-review"),
      jobId: nextId("fake-job"),
      reviewerId: nextId("fake-user"),
      revieweeProfessionalProfileId: nextId("fake-professional"),
      rating: 5,
      comment: "Great work",
      status: "PUBLISHED",
      createdAt: now,
      ...overrides,
    };
    this.reviews.set(record.id, record);
    return record;
  }

  seedPortfolioItem(overrides: Partial<AdminPortfolioItemRecord> = {}): AdminPortfolioItemRecord {
    const now = new Date();
    const record: AdminPortfolioItemRecord = {
      id: nextId("fake-portfolio-item"),
      professionalProfileId: nextId("fake-professional"),
      companyProfileId: null,
      title: "Bathroom remodel",
      mediaUrl: "https://cdn.example.com/img.jpg",
      moderatedAt: null,
      deletedAt: null,
      createdAt: now,
      ...overrides,
    };
    this.portfolioItems.set(record.id, record);
    return record;
  }

  async getDashboardOverview(): Promise<AdminDashboardOverview> {
    return {
      totalUsers: this.users.size,
      totalProfessionals: this.professionals.size,
      totalServiceRequests: this.serviceRequests.size,
      totalQuotes: this.quotes.size,
      totalAppointments: 0,
      totalJobs: this.jobs.size,
      totalReviews: this.reviews.size,
      totalPortfolioItems: this.portfolioItems.size,
      totalNotifications: 0,
      unreadNotifications: 0,
      totalCompanies: this.companies.size,
    };
  }

  async listUsers(options: ListAdminUsersOptions): Promise<AdminUserRecord[]> {
    const search = options.search?.toLowerCase();
    return [...this.users.values()]
      .filter((u) => {
        if (!search) return true;
        return (u.name ?? "").toLowerCase().includes(search) || (u.email ?? "").toLowerCase().includes(search);
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getUserById(id: string): Promise<AdminUserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async countActiveAdmins(): Promise<number> {
    return [...this.users.values()].filter(
      (u) => u.status === "ACTIVE" && (u.roles.includes("ADMIN") || u.roles.includes("SUPER_ADMIN")),
    ).length;
  }

  async setUserStatus(userId: string, status: AdminUserStatusValue): Promise<AdminUserRecord | null> {
    const existing = this.users.get(userId);
    if (!existing) return null;
    const updated = { ...existing, status };
    this.users.set(userId, updated);
    return updated;
  }

  async setUserRoles(userId: string, roleKeys: string[]): Promise<AdminUserRecord | null> {
    const existing = this.users.get(userId);
    if (!existing) return null;
    const updated = { ...existing, roles: [...roleKeys] };
    this.users.set(userId, updated);
    return updated;
  }

  async listRoleKeys(): Promise<string[]> {
    return [...this.roleKeys];
  }

  async listProfessionals(options: ListAdminProfessionalsOptions): Promise<AdminProfessionalRecord[]> {
    const search = options.search?.toLowerCase();
    return [...this.professionals.values()]
      .filter((p) => {
        if (!search) return true;
        return (p.businessName ?? "").toLowerCase().includes(search) || (p.userName ?? "").toLowerCase().includes(search);
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getProfessionalById(id: string): Promise<AdminProfessionalRecord | null> {
    return this.professionals.get(id) ?? null;
  }

  /** Module 83 — Professional Verification Enforcement. Mirrors
   *  setCompanyStatus below exactly. */
  async setProfessionalStatus(
    id: string,
    status: AdminProfessionalStatusValue,
  ): Promise<AdminProfessionalRecord | null> {
    const existing = this.professionals.get(id);
    if (!existing) return null;
    const updated = { ...existing, status };
    this.professionals.set(id, updated);
    return updated;
  }

  async listServiceRequests(options: ListAdminServiceRequestsOptions): Promise<AdminServiceRequestRecord[]> {
    return [...this.serviceRequests.values()]
      .filter((r) => !options.status || r.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getServiceRequestById(id: string): Promise<AdminServiceRequestRecord | null> {
    return this.serviceRequests.get(id) ?? null;
  }

  async listQuotes(options: ListAdminQuotesOptions): Promise<AdminQuoteRecord[]> {
    return [...this.quotes.values()]
      .filter((q) => !options.status || q.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getQuoteById(id: string): Promise<AdminQuoteRecord | null> {
    return this.quotes.get(id) ?? null;
  }

  async listJobs(options: ListAdminJobsOptions): Promise<AdminJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => !options.status || j.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getJobById(id: string): Promise<AdminJobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async listReviews(options: ListAdminReviewsOptions): Promise<AdminReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((r) => !options.status || r.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getReviewById(id: string): Promise<AdminReviewRecord | null> {
    return this.reviews.get(id) ?? null;
  }

  async setReviewStatus(id: string, status: AdminReviewStatusValue): Promise<AdminReviewRecord | null> {
    const existing = this.reviews.get(id);
    if (!existing) return null;
    const updated = { ...existing, status };
    this.reviews.set(id, updated);
    return updated;
  }

  async listPortfolioItems(options: ListAdminPortfolioItemsOptions): Promise<AdminPortfolioItemRecord[]> {
    return [...this.portfolioItems.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getPortfolioItemById(id: string): Promise<AdminPortfolioItemRecord | null> {
    return this.portfolioItems.get(id) ?? null;
  }

  async setPortfolioItemModeratedAt(id: string, moderatedAt: Date | null): Promise<AdminPortfolioItemRecord | null> {
    const existing = this.portfolioItems.get(id);
    if (!existing) return null;
    const updated = { ...existing, moderatedAt };
    this.portfolioItems.set(id, updated);
    return updated;
  }

  async listCompanies(options: ListAdminCompaniesOptions): Promise<AdminCompanyRecord[]> {
    const search = options.search?.toLowerCase();
    return [...this.companies.values()]
      .filter((c) => !options.status || c.status === options.status)
      .filter((c) => {
        if (!search) return true;
        return (
          c.legalName.toLowerCase().includes(search) ||
          (c.tradeName ?? "").toLowerCase().includes(search) ||
          (c.ownerName ?? "").toLowerCase().includes(search)
        );
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getCompanyById(id: string): Promise<AdminCompanyRecord | null> {
    return this.companies.get(id) ?? null;
  }

  async setCompanyStatus(
    id: string,
    status: AdminCompanyStatusValue,
    suspendedAt: Date | null,
  ): Promise<AdminCompanyRecord | null> {
    const existing = this.companies.get(id);
    if (!existing) return null;
    const updated = { ...existing, status };
    this.companies.set(id, updated);
    void suspendedAt;
    return updated;
  }
}

export class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    const record: AdminAuditLogRecord = {
      id: nextId("fake-audit-log"),
      adminUserId: data.adminUserId,
      action: data.action as AdminAuditAction,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.entries.push(record);
    return record;
  }

  async list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    // `this.entries` is always in insertion order (see `record` above,
    // which only ever `push`es). Sorting purely by `createdAt` is not
    // enough to guarantee "newest first": two entries recorded in the same
    // synchronous test (e.g. two back-to-back `suspend.execute()` calls)
    // can land on the exact same millisecond, since `new Date()` in a tight
    // loop has coarser resolution than the time between statements. A plain
    // `.sort()` is stable, so a tie falls back to the *original* (ascending
    // insertion) order — the opposite of "newest first". Carrying the
    // insertion index through the sort and using it as an explicit,
    // descending tiebreaker keeps ties newest-first regardless of
    // timestamp resolution, matching the real Prisma repository's
    // `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`.
    return this.entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const byCreatedAt = b.entry.createdAt.getTime() - a.entry.createdAt.getTime();
        if (byCreatedAt !== 0) return byCreatedAt;
        return b.index - a.index;
      })
      .map(({ entry }) => entry)
      .slice(options.offset, options.offset + options.limit);
  }
}

export type AdminQuoteStatus = AdminQuoteStatusValue;
export type AdminServiceRequestStatus = AdminServiceRequestStatusValue;
export type AdminJobStatus = AdminJobStatusValue;
