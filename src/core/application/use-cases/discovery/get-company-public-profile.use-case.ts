import { NotFoundError } from "@/domain/errors/domain-error";
import type { CompanyDiscoveryRepository, CompanyPublicProfileRecord } from "@/domain/repositories/company-discovery-repository";

/** Module 18 — Company Professional: the public company profile page, by
 *  id or by slug. Mirrors GetProfessionalPublicProfileUseCase — returns
 *  null-safe records with no internal/private fields (see
 *  CompanyPublicProfileRecord's own doc comment). */
export class GetCompanyPublicProfileUseCase {
  constructor(private readonly discovery: CompanyDiscoveryRepository) {}

  async getById(companyId: string): Promise<CompanyPublicProfileRecord> {
    const profile = await this.discovery.findPublicProfileById(companyId);
    if (!profile) throw new NotFoundError("Company", companyId);
    return profile;
  }

  async getBySlug(slug: string): Promise<CompanyPublicProfileRecord> {
    const profile = await this.discovery.findPublicProfileBySlug(slug);
    if (!profile) throw new NotFoundError("Company", slug);
    return profile;
  }
}
