import { prisma } from "@/infrastructure/database/prisma/client";
import type { Prisma } from "@prisma/client";
import type {
  ProfessionalDiscoveryCandidate,
  ProfessionalDiscoveryRepository,
  ProfessionalPublicProfileRecord,
  ProfessionalSearchFilter,
} from "@/domain/repositories/professional-discovery-repository";

/**
 * Candidate/profile queries reuse the existing ProfessionalProfile / User /
 * Address / ServiceCategory models and relations — no new tables. A
 * professional's "base location" is read from their own primary Address
 * (most recent default address with coordinates set), the same address
 * concept the Profile module already uses elsewhere.
 *
 * MVP note: geographic filtering (radius/distance) is NOT done at the
 * database level here — this repository returns all ACTIVE candidates for
 * a category with whatever coordinates they have, and
 * SearchProfessionalsUseCase applies the Haversine distance + per-
 * professional-radius rule in the application layer. This keeps the
 * business rule testable independent of Prisma/Postgres and leaves the
 * door open to later push this down to PostGIS/a spatial index without
 * changing the use case at all.
 *
 * Search & Ranking module (Module 19): `searchCandidates` adds category/
 * text/city/province/verification/rating/review-count filtering at the
 * database level (see the `@@index` additions in the Module 19 migration).
 * It deliberately does NOT filter by geographic radius — that stays
 * Professional Discovery's own per-professional-radius rule, orthogonal to
 * directory search — and ranking/scoring of the returned candidates happens
 * entirely in SearchDirectoryUseCase, never here.
 */

// Deliberately not `as const` — Prisma's generated arg types expect plain
// (mutable) arrays for `orderBy`, and a `readonly` tuple from `as const`
// does not structurally satisfy that in every Prisma version.
const ADDRESS_SELECT = {
  where: { deletedAt: null },
  orderBy: [{ isDefault: "desc" as const }, { updatedAt: "desc" as const }],
  take: 1,
  select: { latitude: true, longitude: true, city: true, province: true },
};

const CANDIDATE_SELECT = {
  id: true,
  businessName: true,
  headline: true,
  yearsExperience: true,
  hourlyRate: true,
  serviceRadiusKm: true,
  verificationStatus: true,
  averageRating: true,
  reviewCount: true,
  createdAt: true,
  categories: { select: { id: true } },
  user: {
    select: {
      name: true,
      image: true,
      addresses: ADDRESS_SELECT,
    },
  },
  _count: {
    select: {
      portfolioItems: { where: { deletedAt: null, moderatedAt: null } },
    },
  },
} as const;

type CandidateRow = {
  id: string;
  businessName: string | null;
  headline: string | null;
  yearsExperience: number | null;
  hourlyRate: unknown;
  serviceRadiusKm: number | null;
  verificationStatus: string;
  averageRating: unknown;
  reviewCount: number;
  createdAt: Date;
  categories: { id: string }[];
  user: {
    name: string | null;
    image: string | null;
    addresses: { latitude: number | null; longitude: number | null; city: string; province: string | null }[];
  };
  _count: { portfolioItems: number };
};

function toCandidate(row: CandidateRow): ProfessionalDiscoveryCandidate {
  const address = row.user.addresses[0];
  return {
    id: row.id,
    displayName: row.user.name ?? row.businessName ?? "Professional",
    businessName: row.businessName,
    headline: row.headline,
    yearsExperience: row.yearsExperience,
    hourlyRate: row.hourlyRate === null ? null : Number(row.hourlyRate),
    serviceRadiusKm: row.serviceRadiusKm,
    verificationStatus: row.verificationStatus as ProfessionalDiscoveryCandidate["verificationStatus"],
    profileImageUrl: row.user.image,
    categoryIds: row.categories.map((c) => c.id),
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
    city: address?.city ?? null,
    province: address?.province ?? null,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: row.reviewCount,
    portfolioItemCount: row._count.portfolioItems,
    createdAt: row.createdAt,
  };
}

export class PrismaProfessionalDiscoveryRepository implements ProfessionalDiscoveryRepository {
  async findActiveCandidatesByCategory(categoryId: string): Promise<ProfessionalDiscoveryCandidate[]> {
    const rows = await prisma.professionalProfile.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        categories: { some: { id: categoryId, status: "ACTIVE", deletedAt: null } },
      },
      select: CANDIDATE_SELECT,
    });

    return rows.map(toCandidate);
  }

  async findCandidateById(professionalId: string): Promise<ProfessionalDiscoveryCandidate | null> {
    const row = await prisma.professionalProfile.findFirst({
      where: { id: professionalId, status: "ACTIVE", deletedAt: null },
      select: CANDIDATE_SELECT,
    });
    return row ? toCandidate(row) : null;
  }

  async findPublicProfileById(professionalId: string): Promise<ProfessionalPublicProfileRecord | null> {
    const row = await prisma.professionalProfile.findFirst({
      where: { id: professionalId, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        businessName: true,
        headline: true,
        bio: true,
        yearsExperience: true,
        hourlyRate: true,
        serviceRadiusKm: true,
        verificationStatus: true,
        categories: { select: { id: true } },
        user: {
          select: {
            name: true,
            image: true,
            addresses: ADDRESS_SELECT,
          },
        },
      },
    });

    if (!row) return null;

    const address = row.user.addresses[0];

    return {
      id: row.id,
      displayName: row.user.name ?? row.businessName ?? "Professional",
      businessName: row.businessName,
      headline: row.headline,
      bio: row.bio,
      yearsExperience: row.yearsExperience,
      hourlyRate: row.hourlyRate === null ? null : Number(row.hourlyRate),
      serviceRadiusKm: row.serviceRadiusKm,
      verificationStatus: row.verificationStatus as ProfessionalPublicProfileRecord["verificationStatus"],
      profileImageUrl: row.user.image,
      categoryIds: row.categories.map((c) => c.id),
      city: address?.city ?? null,
      province: address?.province ?? null,
    };
  }

  async searchCandidates(filter: ProfessionalSearchFilter): Promise<ProfessionalDiscoveryCandidate[]> {
    const where: Prisma.ProfessionalProfileWhereInput = {
      status: "ACTIVE",
      deletedAt: null,
    };

    if (filter.categoryId) {
      where.categories = { some: { id: filter.categoryId, status: "ACTIVE", deletedAt: null } };
    }
    if (filter.verifiedOnly) {
      where.verificationStatus = "VERIFIED";
    }
    if (typeof filter.minRating === "number") {
      where.averageRating = { gte: filter.minRating };
    }
    if (typeof filter.minReviewCount === "number") {
      where.reviewCount = { gte: filter.minReviewCount };
    }
    if (filter.city || filter.province) {
      where.user = {
        addresses: {
          some: {
            deletedAt: null,
            ...(filter.city ? { city: { equals: filter.city, mode: "insensitive" } } : {}),
            ...(filter.province ? { province: { equals: filter.province, mode: "insensitive" } } : {}),
          },
        },
      };
    }
    if (filter.query) {
      where.OR = [
        { businessName: { contains: filter.query, mode: "insensitive" } },
        { headline: { contains: filter.query, mode: "insensitive" } },
        { user: { name: { contains: filter.query, mode: "insensitive" } } },
      ];
    }

    const rows = await prisma.professionalProfile.findMany({ where, select: CANDIDATE_SELECT });
    return rows.map(toCandidate);
  }
}
