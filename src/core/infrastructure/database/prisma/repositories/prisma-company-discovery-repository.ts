import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  CompanyDiscoveryCandidate,
  CompanyDiscoveryRepository,
  CompanyPublicProfileRecord,
} from "@/domain/repositories/company-discovery-repository";

/** Module 18 — Company Professional: Prisma implementation of
 *  CompanyDiscoveryRepository — the company-side mirror of
 *  PrismaProfessionalDiscoveryRepository. Only ACTIVE (CompanyStatus)
 *  companies are ever returned — never PENDING/SUSPENDED/DEACTIVATED,
 *  matching isCompanyDiscoverable's own rule. `teamSize` counts active
 *  (joined, not removed) members only — never exposes who they are. */

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
  categories: { select: { id: true } },
  members: { where: { joinedAt: { not: null }, removedAt: null }, select: { id: true } },
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
  categories: { id: string }[];
  members: { id: string }[];
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
    teamSize: row.members.length,
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
        members: { where: { joinedAt: { not: null }, removedAt: null }, select: { id: true } },
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
      teamSize: row.members.length,
    };
  }
}
