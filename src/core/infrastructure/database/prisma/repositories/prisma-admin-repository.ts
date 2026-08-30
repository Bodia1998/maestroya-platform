import { prisma } from "@/infrastructure/database/prisma/client";
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
  AdminVerificationStatusValue,
  ListAdminCompaniesOptions,
  ListAdminJobsOptions,
  ListAdminPortfolioItemsOptions,
  ListAdminProfessionalsOptions,
  ListAdminQuotesOptions,
  ListAdminReviewsOptions,
  ListAdminServiceRequestsOptions,
  ListAdminUsersOptions,
} from "@/domain/repositories/admin-repository";

const ADMIN_ROLE_KEYS = ["ADMIN", "SUPER_ADMIN"] as const;

/**
 * Admin Panel module (Module 16): Prisma implementation of AdminRepository.
 * Same "narrow SELECTs, plain-object mapping, no Prisma types leaking past
 * this file" convention as every other Prisma repository in this codebase.
 *
 * Every list method here is genuinely read-only oversight — no method
 * mutates Quote/Appointment/Job/ServiceRequest state, matching the module
 * spec's "oversight, not a second business-logic implementation" boundary.
 * Only User.status/roles, Review.status, and PortfolioItem.moderatedAt are
 * ever written here.
 */
export class PrismaAdminRepository implements AdminRepository {
  async getDashboardOverview(): Promise<AdminDashboardOverview> {
    const [
      totalUsers,
      totalProfessionals,
      totalServiceRequests,
      totalQuotes,
      totalAppointments,
      totalJobs,
      totalReviews,
      totalPortfolioItems,
      totalNotifications,
      unreadNotifications,
      totalCompanies,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.professionalProfile.count({ where: { deletedAt: null } }),
      prisma.serviceRequest.count({ where: { deletedAt: null } }),
      prisma.quote.count(),
      prisma.appointment.count(),
      prisma.job.count(),
      prisma.review.count(),
      prisma.portfolioItem.count({ where: { deletedAt: null } }),
      prisma.notification.count({ where: { dismissedAt: null } }),
      prisma.notification.count({ where: { readAt: null, dismissedAt: null } }),
      prisma.companyProfile.count({ where: { deletedAt: null } }),
    ]);

    return {
      totalUsers,
      totalProfessionals,
      totalServiceRequests,
      totalQuotes,
      totalAppointments,
      totalJobs,
      totalReviews,
      totalPortfolioItems,
      totalNotifications,
      unreadNotifications,
      totalCompanies,
    };
  }

  // -------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------

  async listUsers(options: ListAdminUsersOptions): Promise<AdminUserRecord[]> {
    const search = options.search?.trim();
    const rows = await prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: userSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toUserRecord);
  }

  async getUserById(id: string): Promise<AdminUserRecord | null> {
    const row = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: userSelect });
    return row ? toUserRecord(row) : null;
  }

  async countActiveAdmins(): Promise<number> {
    return prisma.user.count({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        roles: { some: { role: { key: { in: [...ADMIN_ROLE_KEYS] } } } },
      },
    });
  }

  async setUserStatus(userId: string, status: AdminUserStatusValue): Promise<AdminUserRecord | null> {
    const existing = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!existing) return null;
    const row = await prisma.user.update({ where: { id: userId }, data: { status }, select: userSelect });
    return toUserRecord(row);
  }

  async setUserRoles(userId: string, roleKeys: string[]): Promise<AdminUserRecord | null> {
    const existing = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!existing) return null;

    const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });

    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.userRole.createMany({
        data: roles.map((role) => ({ userId, roleId: role.id })),
        skipDuplicates: true,
      }),
    ]);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
    return toUserRecord(row);
  }

  async listRoleKeys(): Promise<string[]> {
    const roles = await prisma.role.findMany({ select: { key: true } });
    return roles.map((r) => r.key);
  }

  // -------------------------------------------------------------------
  // Professionals
  // -------------------------------------------------------------------

  async listProfessionals(options: ListAdminProfessionalsOptions): Promise<AdminProfessionalRecord[]> {
    const search = options.search?.trim();
    const rows = await prisma.professionalProfile.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { businessName: { contains: search, mode: "insensitive" as const } },
                { user: { name: { contains: search, mode: "insensitive" as const } } },
                { user: { email: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      select: professionalSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toProfessionalRecord);
  }

  async getProfessionalById(id: string): Promise<AdminProfessionalRecord | null> {
    const row = await prisma.professionalProfile.findFirst({
      where: { id, deletedAt: null },
      select: professionalSelect,
    });
    return row ? toProfessionalRecord(row) : null;
  }

  /** Module 83 — Professional Verification Enforcement. Mirrors
   *  setCompanyStatus below exactly. */
  async setProfessionalStatus(
    id: string,
    status: AdminProfessionalStatusValue,
  ): Promise<AdminProfessionalRecord | null> {
    const existing = await prisma.professionalProfile.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return null;
    const row = await prisma.professionalProfile.update({
      where: { id },
      data: { status },
      select: professionalSelect,
    });
    return toProfessionalRecord(row);
  }

  // -------------------------------------------------------------------
  // Service requests
  // -------------------------------------------------------------------

  async listServiceRequests(options: ListAdminServiceRequestsOptions): Promise<AdminServiceRequestRecord[]> {
    const rows = await prisma.serviceRequest.findMany({
      where: { deletedAt: null, ...(options.status ? { status: options.status } : {}) },
      select: serviceRequestSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toServiceRequestRecord);
  }

  async getServiceRequestById(id: string): Promise<AdminServiceRequestRecord | null> {
    const row = await prisma.serviceRequest.findFirst({ where: { id, deletedAt: null }, select: serviceRequestSelect });
    return row ? toServiceRequestRecord(row) : null;
  }

  // -------------------------------------------------------------------
  // Quotes
  // -------------------------------------------------------------------

  async listQuotes(options: ListAdminQuotesOptions): Promise<AdminQuoteRecord[]> {
    const rows = await prisma.quote.findMany({
      where: options.status ? { status: options.status } : {},
      select: quoteSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toQuoteRecord);
  }

  async getQuoteById(id: string): Promise<AdminQuoteRecord | null> {
    const row = await prisma.quote.findUnique({ where: { id }, select: quoteSelect });
    return row ? toQuoteRecord(row) : null;
  }

  // -------------------------------------------------------------------
  // Jobs / appointments
  // -------------------------------------------------------------------

  async listJobs(options: ListAdminJobsOptions): Promise<AdminJobRecord[]> {
    const rows = await prisma.job.findMany({
      where: options.status ? { status: options.status } : {},
      select: jobSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toJobRecord);
  }

  async getJobById(id: string): Promise<AdminJobRecord | null> {
    const row = await prisma.job.findUnique({ where: { id }, select: jobSelect });
    return row ? toJobRecord(row) : null;
  }

  // -------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------

  async listReviews(options: ListAdminReviewsOptions): Promise<AdminReviewRecord[]> {
    const rows = await prisma.review.findMany({
      where: options.status ? { status: options.status } : {},
      select: reviewSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toReviewRecord);
  }

  async getReviewById(id: string): Promise<AdminReviewRecord | null> {
    const row = await prisma.review.findUnique({ where: { id }, select: reviewSelect });
    return row ? toReviewRecord(row) : null;
  }

  async setReviewStatus(id: string, status: AdminReviewStatusValue): Promise<AdminReviewRecord | null> {
    const existing = await prisma.review.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await prisma.review.update({ where: { id }, data: { status }, select: reviewSelect });
    return toReviewRecord(row);
  }

  // -------------------------------------------------------------------
  // Portfolio items
  // -------------------------------------------------------------------

  async listPortfolioItems(options: ListAdminPortfolioItemsOptions): Promise<AdminPortfolioItemRecord[]> {
    const rows = await prisma.portfolioItem.findMany({
      select: portfolioSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toPortfolioRecord);
  }

  async getPortfolioItemById(id: string): Promise<AdminPortfolioItemRecord | null> {
    const row = await prisma.portfolioItem.findUnique({ where: { id }, select: portfolioSelect });
    return row ? toPortfolioRecord(row) : null;
  }

  async setPortfolioItemModeratedAt(id: string, moderatedAt: Date | null): Promise<AdminPortfolioItemRecord | null> {
    const existing = await prisma.portfolioItem.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await prisma.portfolioItem.update({ where: { id }, data: { moderatedAt }, select: portfolioSelect });
    return toPortfolioRecord(row);
  }

  // -------------------------------------------------------------------
  // Companies (Module 18 — Company Professional)
  // -------------------------------------------------------------------

  async listCompanies(options: ListAdminCompaniesOptions): Promise<AdminCompanyRecord[]> {
    const search = options.search?.trim();
    const rows = await prisma.companyProfile.findMany({
      where: {
        deletedAt: null,
        ...(options.status ? { status: options.status } : {}),
        ...(search
          ? {
              OR: [
                { legalName: { contains: search, mode: "insensitive" as const } },
                { tradeName: { contains: search, mode: "insensitive" as const } },
                { owner: { name: { contains: search, mode: "insensitive" as const } } },
                { owner: { email: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      select: companySelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toCompanyRecord);
  }

  async getCompanyById(id: string): Promise<AdminCompanyRecord | null> {
    const row = await prisma.companyProfile.findFirst({ where: { id, deletedAt: null }, select: companySelect });
    return row ? toCompanyRecord(row) : null;
  }

  async setCompanyStatus(
    id: string,
    status: AdminCompanyStatusValue,
    suspendedAt: Date | null,
  ): Promise<AdminCompanyRecord | null> {
    const existing = await prisma.companyProfile.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await prisma.companyProfile.update({
      where: { id },
      data: { status, suspendedAt },
      select: companySelect,
    });
    return toCompanyRecord(row);
  }
}

// ---------------------------------------------------------------------------
// Selects + mappers
// ---------------------------------------------------------------------------

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  professionalProfile: { select: { id: true } },
  roles: { select: { role: { select: { key: true } } } },
} as const;

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  professionalProfile: { id: string } | null;
  roles: { role: { key: string } }[];
};

function toUserRecord(row: UserRow): AdminUserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status as AdminUserStatusValue,
    roles: row.roles.map((r) => r.role.key),
    hasProfessionalProfile: row.professionalProfile !== null,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

const professionalSelect = {
  id: true,
  userId: true,
  businessName: true,
  status: true,
  verificationStatus: true,
  averageRating: true,
  reviewCount: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
  _count: { select: { portfolioItems: { where: { deletedAt: null } } } },
} as const;

type ProfessionalRow = {
  id: string;
  userId: string;
  businessName: string | null;
  status: string;
  verificationStatus: string;
  averageRating: unknown;
  reviewCount: number;
  createdAt: Date;
  user: { name: string | null; email: string | null };
  _count: { portfolioItems: number };
};

function toProfessionalRecord(row: ProfessionalRow): AdminProfessionalRecord {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    userEmail: row.user.email,
    businessName: row.businessName,
    status: row.status as AdminProfessionalStatusValue,
    verificationStatus: row.verificationStatus as AdminVerificationStatusValue,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: row.reviewCount,
    portfolioItemCount: row._count.portfolioItems,
    createdAt: row.createdAt,
  };
}

const companySelect = {
  id: true,
  ownerUserId: true,
  legalName: true,
  tradeName: true,
  taxId: true,
  status: true,
  isVerified: true,
  averageRating: true,
  reviewCount: true,
  createdAt: true,
  owner: { select: { name: true, email: true } },
  _count: { select: { members: { where: { joinedAt: { not: null }, removedAt: null } } } },
} as const;

type CompanyRow = {
  id: string;
  ownerUserId: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  status: string;
  isVerified: boolean;
  averageRating: unknown;
  reviewCount: number;
  createdAt: Date;
  owner: { name: string | null; email: string | null };
  _count: { members: number };
};

function toCompanyRecord(row: CompanyRow): AdminCompanyRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    ownerName: row.owner.name,
    ownerEmail: row.owner.email,
    legalName: row.legalName,
    tradeName: row.tradeName,
    taxId: row.taxId,
    status: row.status as AdminCompanyStatusValue,
    isVerified: row.isVerified,
    memberCount: row._count.members,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: row.reviewCount,
    createdAt: row.createdAt,
  };
}

const serviceRequestSelect = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
  customer: { select: { id: true, userId: true, user: { select: { name: true } } } },
  _count: { select: { quotes: true, jobs: true } },
} as const;

type ServiceRequestRow = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  customer: { id: string; userId: string; user: { name: string | null } };
  _count: { quotes: number; jobs: number };
};

function toServiceRequestRecord(row: ServiceRequestRow): AdminServiceRequestRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status as AdminServiceRequestStatusValue,
    customerId: row.customer.id,
    customerUserId: row.customer.userId,
    customerName: row.customer.user.name,
    quoteCount: row._count.quotes,
    jobCount: row._count.jobs,
    createdAt: row.createdAt,
  };
}

const quoteSelect = {
  id: true,
  serviceRequestId: true,
  professionalProfileId: true,
  submittedByUserId: true,
  status: true,
  totalAmount: true,
  currency: true,
  createdAt: true,
  serviceRequest: { select: { title: true } },
} as const;

type QuoteRow = {
  id: string;
  serviceRequestId: string;
  professionalProfileId: string | null;
  submittedByUserId: string;
  status: string;
  totalAmount: unknown;
  currency: string;
  createdAt: Date;
  serviceRequest: { title: string };
};

function toQuoteRecord(row: QuoteRow): AdminQuoteRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    serviceRequestTitle: row.serviceRequest.title,
    professionalProfileId: row.professionalProfileId,
    submittedByUserId: row.submittedByUserId,
    status: row.status as AdminQuoteStatusValue,
    totalAmount: Number(row.totalAmount),
    currency: row.currency,
    createdAt: row.createdAt,
  };
}

const jobSelect = {
  id: true,
  serviceRequestId: true,
  quoteId: true,
  customerId: true,
  professionalProfileId: true,
  status: true,
  createdAt: true,
  _count: { select: { appointments: true } },
} as const;

type JobRow = {
  id: string;
  serviceRequestId: string;
  quoteId: string;
  customerId: string;
  professionalProfileId: string | null;
  status: string;
  createdAt: Date;
  _count: { appointments: number };
};

function toJobRecord(row: JobRow): AdminJobRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    quoteId: row.quoteId,
    customerId: row.customerId,
    professionalProfileId: row.professionalProfileId,
    status: row.status as AdminJobStatusValue,
    appointmentCount: row._count.appointments,
    createdAt: row.createdAt,
  };
}

const reviewSelect = {
  id: true,
  jobId: true,
  reviewerId: true,
  revieweeProfessionalProfileId: true,
  rating: true,
  comment: true,
  status: true,
  createdAt: true,
} as const;

type ReviewRow = {
  id: string;
  jobId: string;
  reviewerId: string;
  revieweeProfessionalProfileId: string | null;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: Date;
};

function toReviewRecord(row: ReviewRow): AdminReviewRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    reviewerId: row.reviewerId,
    revieweeProfessionalProfileId: row.revieweeProfessionalProfileId,
    rating: row.rating,
    comment: row.comment,
    status: row.status as AdminReviewStatusValue,
    createdAt: row.createdAt,
  };
}

const portfolioSelect = {
  id: true,
  professionalProfileId: true,
  companyProfileId: true,
  title: true,
  mediaUrl: true,
  moderatedAt: true,
  deletedAt: true,
  createdAt: true,
} as const;

type PortfolioRow = {
  id: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  title: string;
  mediaUrl: string;
  moderatedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

function toPortfolioRecord(row: PortfolioRow): AdminPortfolioItemRecord {
  return {
    id: row.id,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    title: row.title,
    mediaUrl: row.mediaUrl,
    moderatedAt: row.moderatedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}
