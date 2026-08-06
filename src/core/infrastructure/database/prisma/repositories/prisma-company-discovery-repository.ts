import { prisma } from "@/infrastructure/database/prisma/client";
import type { Prisma } from "@prisma/client";
import { computeBoundingBox } from "@/domain/services/geo-distance";
import type {
  CompanyDiscoveryCandidate,
  CompanyDiscoveryRepository,
  CompanyPublicProfileRecord,
  CompanySearchFilter,
} from "@/domain/repositories/company-discovery-repository";

/** Module 18 — Company Professional: Prisma implementation of
 *  CompanyDiscoveryRepository — the company-side mirror of
 *  PrismaProfessionalDiscoveryRepository. Only ACTIVE (CompanyStatus)
 *  companies are ever returned — never PENDING/SUSPENDED/DEACTIVATED,
 *  matching isCompanyDiscoverable's own rule. `teamSize` counts active
 *  (joined, not removed) members only — never exposes who they are.
 *
 *  Search & Ranking module (Module 19): `searchCandidates` adds the same
 *  database-level filtering `PrismaProfessionalDiscoveryRepository.searchCandidates`
 *  provides for professionals — see that method's own doc comment. */

const CANDIDATE_SELECT = {
  id: true,
  legalName: true,
  tradeName: true,
  description: true,
  logoUrl: true,
  isVerified: true,
  averageRating: true,
  reviewCount: true,
  city: true,
  province: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  categories: { select: { id: true } },
  _count: {
    select: {
      portfolioItems: { where: { deletedAt: null, moderatedAt: null } },
      members: { where: { joinedAt: { not: null }, removedAt: null } },
    },
  },
} as const;

type CandidateRow = {
  id: string;
  legalName: string;
  tradeName: string | null;
  description: string | null;
  logoUrl: string | null;
  isVerified: boolean;
  averageRating: unknown;
  reviewCount: number;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
  categories: { id: string }[];
  _count: { portfolioItems: number; members: number };
};

function toCandidate(row: CandidateRow): CompanyDiscoveryCandidate {
  return {
    id: row.id,
    displayName: row.tradeName ?? row.legalName,
    legalName: row.legalName,
    description: row.description,
    logoUrl: row.logoUrl,
    isVerified: row.isVerified,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: row.reviewCount,
    categoryIds: row.categories.map((c) => c.id),
    city: row.city,
    province: row.province,
    latitude: row.latitude,
    longitude: row.longitude,
    teamSize: row._count.members,
    portfolioItemCount: row._count.portfolioItems,
    createdAt: row.createdAt,
  };
}

export class PrismaCompanyDiscoveryRepository implements CompanyDiscoveryRepository {
  async findActiveCandidatesByCategory(categoryId: string): Promise<CompanyDiscoveryCandidate[]> {
    const rows = await prisma.companyProfile.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        categories: { some: { id: categoryId, status: "ACTIVE", deletedAt: null } },
      },
      select: CANDIDATE_SELECT,
    });
    return rows.map(toCandidate);
  }

  async findCandidateById(companyId: string): Promise<CompanyDiscoveryCandidate | null> {
    const row = await prisma.companyProfile.findFirst({
      where: { id: companyId, status: "ACTIVE", deletedAt: null },
      select: CANDIDATE_SELECT,
    });
    return row ? toCandidate(row) : null;
  }

  async findPublicProfileById(companyId: string): Promise<CompanyPublicProfileRecord | null> {
    return this.findPublicProfile({ id: companyId, status: "ACTIVE", deletedAt: null });
  }

  async findPublicProfileBySlug(slug: string): Promise<CompanyPublicProfileRecord | null> {
    return this.findPublicProfile({ slug, status: "ACTIVE", deletedAt: null });
  }

  async searchCandidates(filter: CompanySearchFilter): Promise<CompanyDiscoveryCandidate[]> {
    const where: Prisma.CompanyProfileWhereInput = {
      status: "ACTIVE",
      deletedAt: null,
    };

    if (filter.categoryId) {
      where.categories = { some: { id: filter.categoryId, status: "ACTIVE", deletedAt: null } };
    }
    if (filter.verifiedOnly) {
      where.isVerified = true;
    }
    if (typeof filter.minRating === "number") {
      where.averageRating = { gte: filter.minRating };
    }
    if (typeof filter.minReviewCount === "number") {
      where.reviewCount = { gte: filter.minReviewCount };
    }
    if (filter.city) {
      where.city = { equals: filter.city, mode: "insensitive" };
    }
    if (filter.province) {
      where.province = { equals: filter.province, mode: "insensitive" };
    }
    // Maps & Geolocation module (Module 20): see
    // PrismaProfessionalDiscoveryRepository.searchCandidates's own comment —
    // same cheap bounding-box pre-filter, precise cutoff applied afterwards
    // in SearchDirectoryUseCase.
    if (typeof filter.latitude === "number" && typeof filter.longitude === "number" && typeof filter.radiusKm === "number") {
      const box = computeBoundingBox({ latitude: filter.latitude, longitude: filter.longitude }, filter.radiusKm);
      where.latitude = { gte: box.minLatitude, lte: box.maxLatitude };
      where.longitude = { gte: box.minLongitude, lte: box.maxLongitude };
    }
    if (filter.query) {
      where.OR = [
        { legalName: { contains: filter.query, mode: "insensitive" } },
        { tradeName: { contains: filter.query, mode: "insensitive" } },
        { description: { contains: filter.query, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.companyProfile.findMany({ where, select: CANDIDATE_SELECT });
    return rows.map(toCandidate);
  }

  private async findPublicProfile(
    where: { id: string; status: "ACTIVE"; deletedAt: null } | { slug: string; status: "ACTIVE"; deletedAt: null },
  ): Promise<CompanyPublicProfileRecord | null> {
    const row = await prisma.companyProfile.findFirst({
      where,
      select: {
        id: true,
        slug: true,
        legalName: true,
        tradeName: true,
        description: true,
        logoUrl: true,
        websiteUrl: true,
        isVerified: true,
        averageRating: true,
        reviewCount: true,
        city: true,
        province: true,
        categories: { select: { id: true } },
        _count: {
          select: {
            members: { where: { joinedAt: { not: null }, removedAt: null } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.tradeName ?? row.legalName,
      legalName: row.legalName,
      description: row.description,
      logoUrl: row.logoUrl,
      websiteUrl: row.websiteUrl,
      isVerified: row.isVerified,
      averageRating: row.averageRating === null ? null : Number(row.averageRating),
      reviewCount: row.reviewCount,
      categoryIds: row.categories.map((c) => c.id),
      city: row.city,
      province: row.province,
      teamSize: row._count.members,
    };
  }
}
