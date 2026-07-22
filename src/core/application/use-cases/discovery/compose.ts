import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { GetProfessionalPublicProfileUseCase } from "@/application/use-cases/discovery/get-professional-public-profile.use-case";
import { SearchProfessionalsUseCase } from "@/application/use-cases/discovery/search-professionals.use-case";

const discovery = new PrismaProfessionalDiscoveryRepository();
const categories = new PrismaServiceCategoryRepository();

export function makeSearchProfessionalsUseCase() {
  return new SearchProfessionalsUseCase(discovery, categories);
}

export function makeGetProfessionalPublicProfileUseCase() {
  return new GetProfessionalPublicProfileUseCase(discovery);
}
