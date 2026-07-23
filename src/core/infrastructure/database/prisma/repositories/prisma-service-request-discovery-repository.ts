import { prisma } from "@/infrastructure/database/prisma/client";
import type {
  ServiceRequestDiscoveryCandidate,
  ServiceRequestDiscoveryRepository,
} from "@/domain/repositories/service-request-discovery-repository";

/**
 * Offers/Quotes module. Reuses the existing ServiceRequest / Address /
 * CustomerProfile / ServiceCategory models and relations — no new tables.
 *
 * MVP note: same convention as PrismaProfessionalDiscoveryRepository —
 * geographic filtering (radius/distance) is NOT done at the database level
 * here. This repository returns PUBLISHED candidates for the given
 * category ids with whatever address coordinates they have, and
 * GetAvailableServiceRequestsForProfessionalUseCase/CreateQuoteUseCase apply
 * the Haversine distance + per-professional-radius rule in the application
 * layer.
 */
const CANDIDATE_SELECT = {
  id: true,
  title: true,
  description: true,
  categoryId: true,
  urgency: true,
  createdAt: true,
  category: { select: { name: true } },
  address: { select: { city: true, province: true, latitude: true, longitude: true } },
  customer: { select: { userId: true } },
} as const;

type CandidateRow = {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  urgency: string;
  createdAt: Date;
  category: { name: string };
  address: { city: string; province: string | null; latitude: number | null; longitude: number | null };
  customer: { userId: string };
};

function toCandidate(row: CandidateRow): ServiceRequestDiscoveryCandidate {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    urgency: row.urgency as ServiceRequestDiscoveryCandidate["urgency"],
    city: row.address.city,
    province: row.address.province,
    latitude: row.address.latitude,
    longitude: row.address.longitude,
    customerUserId: row.customer.userId,
    createdAt: row.createdAt,
  };
}

export class PrismaServiceRequestDiscoveryRepository implements ServiceRequestDiscoveryRepository {
  async findPublishedById(id: string): Promise<ServiceRequestDiscoveryCandidate | null> {
    const row = await prisma.serviceRequest.findFirst({
      where: { id, status: "PUBLISHED", deletedAt: null },
      select: CANDIDATE_SELECT,
    });
    return row ? toCandidate(row) : null;
  }

  async findPublishedByCategoryIds(categoryIds: string[]): Promise<ServiceRequestDiscoveryCandidate[]> {
    if (categoryIds.length === 0) return [];
    const rows = await prisma.serviceRequest.findMany({
      where: { status: "PUBLISHED", deletedAt: null, categoryId: { in: categoryIds } },
      select: CANDIDATE_SELECT,
    });
    return rows.map(toCandidate);
  }
}
