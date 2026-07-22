import { ValidationError } from "@/domain/errors/domain-error";
import { haversineDistanceKm } from "@/domain/services/geo-distance";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { SearchProfessionalsInput } from "@/application/dto/discovery.dto";

export interface ProfessionalSearchResult {
  id: string;
  displayName: string;
  businessName: string | null;
  headline: string | null;
  yearsExperience: number | null;
  hourlyRate: number | null;
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  profileImageUrl: string | null;
  categoryIds: string[];
  distanceKm: number;
}

export interface SearchProfessionalsResult {
  results: ProfessionalSearchResult[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Finds professionals for a customer's search, following the module's core
 * business rule: there is no single global search radius — each
 * professional's OWN configured `serviceRadiusKm` decides whether they can
 * serve the searched location. A professional is included only when the
 * distance from the searched point to their own base location is within
 * their own radius.
 *
 * Trust boundary: the only inputs accepted from the client are the service
 * category and the searched coordinates (validated by
 * searchProfessionalsSchema before this runs). Professional status,
 * verification status, and eligibility for discovery are never
 * client-controlled — they come entirely from
 * ProfessionalDiscoveryRepository.findActiveCandidatesByCategory, which
 * only ever returns ACTIVE professionals in the first place.
 */
export class SearchProfessionalsUseCase {
  constructor(
    private readonly discovery: ProfessionalDiscoveryRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(input: SearchProfessionalsInput): Promise<SearchProfessionalsResult> {
    const [category] = await this.categories.findActiveByIds([input.categoryId]);
    if (!category) {
      throw new ValidationError("Select a valid, active service category.");
    }

    const candidates = await this.discovery.findActiveCandidatesByCategory(input.categoryId);

    const searchPoint = { latitude: input.latitude, longitude: input.longitude };

    const matches: ProfessionalSearchResult[] = [];
    for (const candidate of candidates) {
      // A professional with no base coordinates yet, or no configured
      // service radius, cannot be geo-matched — excluded rather than
      // guessed at with a fallback/global radius.
      if (candidate.latitude === null || candidate.longitude === null) continue;
      if (candidate.serviceRadiusKm === null) continue;

      const distanceKm = haversineDistanceKm(searchPoint, {
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      });

      if (distanceKm > candidate.serviceRadiusKm) continue;

      matches.push({
        id: candidate.id,
        displayName: candidate.displayName,
        businessName: candidate.businessName,
        headline: candidate.headline,
        yearsExperience: candidate.yearsExperience,
        hourlyRate: candidate.hourlyRate,
        verificationStatus: candidate.verificationStatus,
        profileImageUrl: candidate.profileImageUrl,
        categoryIds: candidate.categoryIds,
        distanceKm: Math.round(distanceKm * 10) / 10,
      });
    }

    // Primary sort: nearest first.
    matches.sort((a, b) => a.distanceKm - b.distanceKm);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const paged = matches.slice(start, start + pageSize);

    return { results: paged, page, pageSize, total: matches.length };
  }
}
