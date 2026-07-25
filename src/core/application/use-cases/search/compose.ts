import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaCompanyDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-discovery-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { SearchDirectoryUseCase } from "@/application/use-cases/search/search-directory.use-case";
import { geocodingProvider } from "@/application/use-cases/geolocation/compose";

/**
 * Search & Ranking module (Module 19) — composition root.
 *
 * Reuses the exact same Prisma repositories Professional Discovery (Module
 * 05) and Company Professional (Module 18) already compose with
 * (`PrismaProfessionalDiscoveryRepository` / `PrismaCompanyDiscoveryRepository`)
 * rather than introducing a parallel set of "search repositories" — Module
 * 19 only adds a new `searchCandidates` method to each existing repository
 * interface/implementation.
 */
const professionalDiscovery = new PrismaProfessionalDiscoveryRepository();
const companyDiscovery = new PrismaCompanyDiscoveryRepository();
const categories = new PrismaServiceCategoryRepository();

export function makeSearchDirectoryUseCase() {
  return new SearchDirectoryUseCase(
    professionalDiscovery,
    companyDiscovery,
    categories,
    () => new Date(),
    // Maps & Geolocation module (Module 20): resolves a search point from a
    // plain city name when the client didn't supply explicit coordinates —
    // see SearchDirectoryUseCase.resolveSearchPoint's own doc comment.
    geocodingProvider,
  );
}
