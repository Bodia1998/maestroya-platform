import type {
  ProfessionalDiscoveryCandidate,
  ProfessionalDiscoveryRepository,
  ProfessionalPublicProfileRecord,
  ProfessionalSearchFilter,
} from "@/domain/repositories/professional-discovery-repository";
import type {
  CompanyDiscoveryCandidate,
  CompanyDiscoveryRepository,
  CompanyPublicProfileRecord,
  CompanySearchFilter,
} from "@/domain/repositories/company-discovery-repository";
import type {
  ServiceCategoryRecord,
  ServiceCategoryRepository,
} from "@/domain/repositories/service-category-repository";

/**
 * Search & Ranking module (Module 19) — in-memory test doubles, following
 * the same convention as tests/integration/discovery/fakes.ts: implement
 * the real repository interfaces so SearchDirectoryUseCase runs its genuine
 * orchestration/ranking logic, with only storage and filtering swapped for
 * a plain in-memory implementation instead of Prisma.
 */

export interface FakeSearchableProfessional extends ProfessionalDiscoveryCandidate {
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
}

export class FakeSearchableProfessionalDiscoveryRepository implements ProfessionalDiscoveryRepository {
  professionals = new Map<string, FakeSearchableProfessional>();

  seed(professional: FakeSearchableProfessional) {
    this.professionals.set(professional.id, professional);
    return professional;
  }

  async findActiveCandidatesByCategory(categoryId: string): Promise<ProfessionalDiscoveryCandidate[]> {
    return this.searchCandidates({ categoryId });
  }

  async findCandidateById(professionalId: string): Promise<ProfessionalDiscoveryCandidate | null> {
    const p = this.professionals.get(professionalId);
    if (!p || p.status !== "ACTIVE") return null;
    const { status: _status, ...candidate } = p;
    return candidate;
  }

  async findPublicProfileById(): Promise<ProfessionalPublicProfileRecord | null> {
    throw new Error("not used in search tests");
  }

  async searchCandidates(filter: ProfessionalSearchFilter): Promise<ProfessionalDiscoveryCandidate[]> {
    return [...this.professionals.values()]
      .filter((p) => p.status === "ACTIVE")
      .filter((p) => !filter.categoryId || p.categoryIds.includes(filter.categoryId))
      .filter((p) => !filter.verifiedOnly || p.verificationStatus === "VERIFIED")
      .filter((p) => filter.minRating === undefined || (p.averageRating ?? 0) >= filter.minRating)
      .filter((p) => filter.minReviewCount === undefined || p.reviewCount >= filter.minReviewCount)
      .filter((p) => !filter.city || (p.city ?? "").toLowerCase() === filter.city.toLowerCase())
      .filter((p) => !filter.province || (p.province ?? "").toLowerCase() === filter.province.toLowerCase())
      .filter((p) => {
        if (!filter.query) return true;
        const haystack = `${p.displayName} ${p.businessName ?? ""} ${p.headline ?? ""}`.toLowerCase();
        return haystack.includes(filter.query.toLowerCase());
      })
      .map(({ status: _status, ...candidate }) => candidate);
  }
}

export interface FakeSearchableCompany extends CompanyDiscoveryCandidate {
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
}

export class FakeSearchableCompanyDiscoveryRepository implements CompanyDiscoveryRepository {
  companies = new Map<string, FakeSearchableCompany>();

  seed(company: FakeSearchableCompany) {
    this.companies.set(company.id, company);
    return company;
  }

  async findActiveCandidatesByCategory(categoryId: string): Promise<CompanyDiscoveryCandidate[]> {
    return this.searchCandidates({ categoryId });
  }

  async findCandidateById(companyId: string): Promise<CompanyDiscoveryCandidate | null> {
    const c = this.companies.get(companyId);
    if (!c || c.status !== "ACTIVE") return null;
    const { status: _status, ...candidate } = c;
    return candidate;
  }

  async findPublicProfileById(): Promise<CompanyPublicProfileRecord | null> {
    throw new Error("not used in search tests");
  }

  async findPublicProfileBySlug(): Promise<CompanyPublicProfileRecord | null> {
    throw new Error("not used in search tests");
  }

  async searchCandidates(filter: CompanySearchFilter): Promise<CompanyDiscoveryCandidate[]> {
    return [...this.companies.values()]
      .filter((c) => c.status === "ACTIVE")
      .filter((c) => !filter.categoryId || c.categoryIds.includes(filter.categoryId))
      .filter((c) => !filter.verifiedOnly || c.isVerified)
      .filter((c) => filter.minRating === undefined || (c.averageRating ?? 0) >= filter.minRating)
      .filter((c) => filter.minReviewCount === undefined || c.reviewCount >= filter.minReviewCount)
      .filter((c) => !filter.city || (c.city ?? "").toLowerCase() === filter.city.toLowerCase())
      .filter((c) => !filter.province || (c.province ?? "").toLowerCase() === filter.province.toLowerCase())
      .filter((c) => {
        if (!filter.query) return true;
        const haystack = `${c.displayName} ${c.legalName} ${c.description ?? ""}`.toLowerCase();
        return haystack.includes(filter.query.toLowerCase());
      })
      .map(({ status: _status, ...candidate }) => candidate);
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
