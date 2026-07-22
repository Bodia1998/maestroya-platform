import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";
import { DeactivateProfessionalUseCase } from "@/application/use-cases/professional/deactivate-professional.use-case";
import { GetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/get-professional-by-user-id.use-case";
import { GetProfessionalUseCase } from "@/application/use-cases/professional/get-professional.use-case";
import { UpdateProfessionalServicesUseCase } from "@/application/use-cases/professional/update-professional-services.use-case";
import { UpdateProfessionalUseCase } from "@/application/use-cases/professional/update-professional.use-case";

const professionals = new PrismaProfessionalRepository();
const categories = new PrismaServiceCategoryRepository();

export function makeCreateProfessionalUseCase() {
  return new CreateProfessionalUseCase(professionals, categories);
}

export function makeGetProfessionalUseCase() {
  return new GetProfessionalUseCase(professionals);
}

export function makeGetProfessionalByUserIdUseCase() {
  return new GetProfessionalByUserIdUseCase(professionals);
}

export function makeUpdateProfessionalUseCase() {
  return new UpdateProfessionalUseCase(professionals);
}

export function makeDeactivateProfessionalUseCase() {
  return new DeactivateProfessionalUseCase(professionals);
}

export function makeUpdateProfessionalServicesUseCase() {
  return new UpdateProfessionalServicesUseCase(professionals, categories);
}
