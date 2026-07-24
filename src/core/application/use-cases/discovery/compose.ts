import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaCompanyDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-discovery-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { GetProfessionalPublicProfileUseCase } from "@/application/use-cases/discovery/get-professional-public-profile.use-case";
import { SearchProfessionalsUseCase } from "@/application/use-cases/discovery/search-professionals.use-case";
import { SearchCompaniesUseCase } from "@/application/use-cases/discovery/search-companies.use-case";
import { GetCompanyPublicProfileUseCase } from "@/application/use-cases/discovery/get-company-public-profile.use-case";

const discovery = new PrismaProfessionalDiscoveryRepository();
const companyDiscovery = new PrismaCompanyDiscoveryRepository();
const categories = new PrismaServiceCategoryRepository();

export function makeSearchProfessionalsUseCase() {
  return new SearchProfessionalsUseCase(discovery, categories);
}

export function makeGetProfessionalPublicProfileUseCase() {
  return new GetProfessionalPublicProfileUseCase(discovery);
}

// --- Companies (Module 18 — Company Professional) ---

export function makeSearchCompaniesUseCase() {
  return new SearchCompaniesUseCase(companyDiscovery, categories);
}

export function makeGetCompanyPublicProfileUseCase() {
  return new GetCompanyPublicProfileUseCase(companyDiscovery);
}
