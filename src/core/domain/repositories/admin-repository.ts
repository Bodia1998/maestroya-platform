/**
 * Admin Panel module (Module 16): repository interface for every read/
 * write operation the Admin Panel needs across existing aggregates (User,
 * ProfessionalProfile, ServiceRequest, Quote, Job/Appointment, Review,
 * PortfolioItem, Notification).
 *
 * Deliberately a single, broad interface rather than one narrow repository
 * per aggregate (the convention every other module in this codebase
 * follows — see ReviewRepository/PortfolioRepository/NotificationRepository
 * for that pattern). The Admin Panel is different in kind: it is an
 * oversight layer that reads *across* aggregates other modules already own
 * (an admin listing users needs role + professional-profile-existence in
 * one page; an admin listing reviews needs reviewer/reviewee context), and
 * introducing eight new narrow repositories — most of them 90% duplicating
 * an existing one just to add pagination/search/admin-only filters — would
 * itself be the kind of "second implementation of existing business logic"
 * the module spec explicitly warns against. This repository is read-mostly
 * (oversight) with a handful of narrow, purpose-built mutations
 * (suspend/reactivate a user, change a role, moderate/restore a review or
 * portfolio item) — it never reimplements quote/job/appointment/booking
 * *business rules*, it only projects their existing state for admin
 * viewing.
 *
 * Every mutation here is a thin, auditable state transition on a field
 * that already existed before this module (User.status, Review.status) or
 * was added by this module for exactly this purpose (PortfolioItem.
 * moderatedAt) — see schema.prisma's doc comments on those fields. No
 * method here ever touches Quote/Appointment/Job/ServiceRequest business
 * state; those remain strictly read-only from the Admin Panel (see the
 * module spec, sections 5.4–5.6).
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface AdminListOptions {
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Dashboard overview
// ---------------------------------------------------------------------------

export interface AdminDashboardOverview {
  totalUsers: number;
  totalProfessionals: number;
  totalServiceRequests: number;
  totalQuotes: number;
  totalAppointments: number;
  totalJobs: number;
  totalReviews: number;
  totalPortfolioItems: number;
  /** Aggregate only — never per-user content. See AdminNotificationOverview's own doc comment. */
  totalNotifications: number;
  unreadNotifications: number;
  /** Module 18 — Company Professional. */
  totalCompanies: number;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export type AdminUserStatusValue = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED";

/** Safe projection — never includes passwordHash or any auth token. */
export interface AdminUserRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: AdminUserStatusValue;
  roles: string[];
  hasProfessionalProfile: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface ListAdminUsersOptions extends AdminListOptions {
  /** Matches against name/email (case-insensitive substring) — the only
   *  identifying fields safe/useful to search on with the current model. */
  search?: string;
}

// ---------------------------------------------------------------------------
// Professionals
// ---------------------------------------------------------------------------

export type AdminProfessionalStatusValue = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type AdminVerificationStatusValue = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface AdminProfessionalRecord {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  businessName: string | null;
  status: AdminProfessionalStatusValue;
  /** Read-only display of existing verification state. Module 16 never
   *  transitions this — that workflow is Module 17. */
  verificationStatus: AdminVerificationStatusValue;
  averageRating: number | null;
  reviewCount: number;
  portfolioItemCount: number;
  createdAt: Date;
}

export interface ListAdminProfessionalsOptions extends AdminListOptions {
  search?: string;
}

// ---------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------

export type AdminServiceRequestStatusValue =
  | "DRAFT"
  | "PUBLISHED"
  | "QUOTED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "DISPUTED";

export interface AdminServiceRequestRecord {
  id: string;
  title: string;
  status: AdminServiceRequestStatusValue;
  customerId: string;
  customerUserId: string;
  customerName: string | null;
  quoteCount: number;
  jobCount: number;
  createdAt: Date;
}

export interface ListAdminServiceRequestsOptions extends AdminListOptions {
  status?: AdminServiceRequestStatusValue;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type AdminQuoteStatusValue = "PENDING" | "SENT" | "VIEWED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "WITHDRAWN";

export interface AdminQuoteRecord {
  id: string;
  serviceRequestId: string;
  serviceRequestTitle: string;
  professionalProfileId: string | null;
  submittedByUserId: string;
  status: AdminQuoteStatusValue;
  totalAmount: number;
  currency: string;
  createdAt: Date;
}

export interface ListAdminQuotesOptions extends AdminListOptions {
  status?: AdminQuoteStatusValue;
}

// ---------------------------------------------------------------------------
// Jobs / appointments
// ---------------------------------------------------------------------------

export type AdminJobStatusValue = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface AdminJobRecord {
  id: string;
  serviceRequestId: string;
  quoteId: string;
  customerId: string;
  professionalProfileId: string | null;
  status: AdminJobStatusValue;
  appointmentCount: number;
  createdAt: Date;
}

export interface ListAdminJobsOptions extends AdminListOptions {
  status?: AdminJobStatusValue;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type AdminReviewStatusValue = "PENDING" | "PUBLISHED" | "FLAGGED" | "REMOVED";

export interface AdminReviewRecord {
  id: string;
  jobId: string;
  reviewerId: string;
  revieweeProfessionalProfileId: string | null;
  rating: number;
  comment: string | null;
  status: AdminReviewStatusValue;
  createdAt: Date;
}

export interface ListAdminReviewsOptions extends AdminListOptions {
  status?: AdminReviewStatusValue;
}

// ---------------------------------------------------------------------------
// Portfolio items
// ---------------------------------------------------------------------------

export interface AdminPortfolioItemRecord {
  id: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  title: string;
  mediaUrl: string;
  moderatedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export type ListAdminPortfolioItemsOptions = AdminListOptions;

// ---------------------------------------------------------------------------
// Companies (Module 18 — Company Professional)
// ---------------------------------------------------------------------------

export type AdminCompanyStatusValue = "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

export interface AdminCompanyRecord {
  id: string;
  ownerUserId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  status: AdminCompanyStatusValue;
  isVerified: boolean;
  memberCount: number;
  averageRating: number | null;
  reviewCount: number;
  createdAt: Date;
}

export interface ListAdminCompaniesOptions extends AdminListOptions {
  search?: string;
  status?: AdminCompanyStatusValue;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface AdminRepository {
  getDashboardOverview(): Promise<AdminDashboardOverview>;

  // Users
  listUsers(options: ListAdminUsersOptions): Promise<AdminUserRecord[]>;
  getUserById(id: string): Promise<AdminUserRecord | null>;
  /** Number of currently-ACTIVE users holding the ADMIN or SUPER_ADMIN
   *  role — used to prevent removing the last admin. Excludes suspended/
   *  banned/deactivated admins, since they can't act as an admin anyway. */
  countActiveAdmins(): Promise<number>;
  setUserStatus(userId: string, status: AdminUserStatusValue): Promise<AdminUserRecord | null>;
  /** Replaces the user's entire role set with exactly `roleKeys`. Validates
   *  each key exists in the Role table (unknown keys throw ValidationError
   *  at the use-case layer, not here — this method trusts its input has
   *  already been validated). */
  setUserRoles(userId: string, roleKeys: string[]): Promise<AdminUserRecord | null>;
  /** All valid role keys currently defined in the Role table — used to
   *  validate a requested role change without hardcoding the enum twice. */
  listRoleKeys(): Promise<string[]>;

  // Professionals
  listProfessionals(options: ListAdminProfessionalsOptions): Promise<AdminProfessionalRecord[]>;
  getProfessionalById(id: string): Promise<AdminProfessionalRecord | null>;
  /** Module 83 — Professional Verification Enforcement: sets
   *  ProfessionalProfile.status. Only ACTIVE <-> SUSPENDED transitions are
   *  driven through this admin path (see admin-rules.ts's
   *  isSuspendableProfessionalStatus/isReactivatableProfessionalStatus) —
   *  INACTIVE is professional-driven only (DeactivateProfessionalUseCase)
   *  and is never written here, mirroring setCompanyStatus's own PENDING/
   *  DEACTIVATED carve-out for companies. */
  setProfessionalStatus(id: string, status: AdminProfessionalStatusValue): Promise<AdminProfessionalRecord | null>;

  // Service requests
  listServiceRequests(options: ListAdminServiceRequestsOptions): Promise<AdminServiceRequestRecord[]>;
  getServiceRequestById(id: string): Promise<AdminServiceRequestRecord | null>;

  // Quotes
  listQuotes(options: ListAdminQuotesOptions): Promise<AdminQuoteRecord[]>;
  getQuoteById(id: string): Promise<AdminQuoteRecord | null>;

  // Jobs / appointments
  listJobs(options: ListAdminJobsOptions): Promise<AdminJobRecord[]>;
  getJobById(id: string): Promise<AdminJobRecord | null>;

  // Reviews
  listReviews(options: ListAdminReviewsOptions): Promise<AdminReviewRecord[]>;
  getReviewById(id: string): Promise<AdminReviewRecord | null>;
  /** Sets Review.status. Module 13's own public listing/rating-aggregation
   *  queries already filter to PUBLISHED only (see PrismaReviewRepository),
   *  so setting REMOVED here automatically excludes it from every public
   *  surface with no further change needed. */
  setReviewStatus(id: string, status: AdminReviewStatusValue): Promise<AdminReviewRecord | null>;

  // Portfolio items
  listPortfolioItems(options: ListAdminPortfolioItemsOptions): Promise<AdminPortfolioItemRecord[]>;
  getPortfolioItemById(id: string): Promise<AdminPortfolioItemRecord | null>;
  setPortfolioItemModeratedAt(id: string, moderatedAt: Date | null): Promise<AdminPortfolioItemRecord | null>;

  // Companies (Module 18)
  listCompanies(options: ListAdminCompaniesOptions): Promise<AdminCompanyRecord[]>;
  getCompanyById(id: string): Promise<AdminCompanyRecord | null>;
  /** Sets CompanyProfile.status. Only ACTIVE <-> SUSPENDED transitions are
   *  driven through this admin path (see company-rules.ts); PENDING/
   *  DEACTIVATED are owner/system-driven and not touched by admin suspend/
   *  reactivate actions. */
  setCompanyStatus(id: string, status: AdminCompanyStatusValue, suspendedAt: Date | null): Promise<AdminCompanyRecord | null>;
}
