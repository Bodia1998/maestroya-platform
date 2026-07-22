import type {
  ProfessionalDiscoveryCandidate,
  ProfessionalDiscoveryRepository,
  ProfessionalPublicProfileRecord,
} from "@/domain/repositories/professional-discovery-repository";
import type {
  ServiceCategoryRecord,
  ServiceCategoryRepository,
} from "@/domain/repositories/service-category-repository";

/**
 * In-memory test doubles for the Professional Discovery & Search module,
 * following the same convention as tests/integration/professional/fakes.ts:
 * implement the real interfaces so use cases run their genuine
 * orchestration/business logic, with only storage swapped out.
 */

export interface FakeDiscoverableProfessional extends ProfessionalDiscoveryCandidate {
  categoryIds: string[];
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  bio: string | null;
  city: string | null;
  province: string | null;
}

export class FakeProfessionalDiscoveryRepository implements ProfessionalDiscoveryRepository {
  professionals = new Map<string, FakeDiscoverableProfessional>();

  seed(professional: FakeDiscoverableProfessional) {
    this.professionals.set(professional.id, professional);
    return professional;
  }

  async findActiveCandidatesByCategory(categoryId: string): Promise<ProfessionalDiscoveryCandidate[]> {
    return [...this.professionals.values()]
      .filter((p) => p.status === "ACTIVE" && p.categoryIds.includes(categoryId))
      .map(({ status: _status, bio: _bio, city: _city, province: _province, ...candidate }) => candidate);
  }

  async findPublicProfileById(professionalId: string): Promise<ProfessionalPublicProfileRecord | null> {
    const professional = this.professionals.get(professionalId);
    if (!professional || professional.status !== "ACTIVE") return null;

    return {
      id: professional.id,
      displayName: professional.displayName,
      businessName: professional.businessName,
      headline: professional.headline,
      bio: professional.bio,
      yearsExperience: professional.yearsExperience,
      hourlyRate: professional.hourlyRate,
      serviceRadiusKm: professional.serviceRadiusKm,
      verificationStatus: professional.verificationStatus,
      profileImageUrl: professional.profileImageUrl,
      categoryIds: professional.categoryIds,
      city: professional.city,
      province: professional.province,
    };
  }
}

export class FakeServiceCategoryRepository implements ServiceCategoryRepository {
  categories = new Map<string, ServiceCategoryRecord>();

  seed(category: ServiceCategoryRecord) {
    this.categories.set(category.id, category);
    return category;
  }

  async listActive() {
    return [...this.categories.values()];
  }

  async findActiveByIds(ids: string[]) {
    const unique = new Set(ids);
    return [...this.categories.values()].filter((c) => unique.has(c.id));
  }
}
