import { PrismaAddressRepository } from "@/infrastructure/database/prisma/repositories/prisma-address-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { CompleteProfessionalOnboardingUseCase } from "@/application/use-cases/professional/complete-professional-onboarding.use-case";
import { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";
import { DeactivateProfessionalUseCase } from "@/application/use-cases/professional/deactivate-professional.use-case";
import { GetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/get-professional-by-user-id.use-case";
import { GetProfessionalUseCase } from "@/application/use-cases/professional/get-professional.use-case";
import { UpdateProfessionalServicesUseCase } from "@/application/use-cases/professional/update-professional-services.use-case";
import { UpdateProfessionalUseCase } from "@/application/use-cases/professional/update-professional.use-case";
import { geocodingProvider } from "@/application/use-cases/geolocation/compose";

const professionals = new PrismaProfessionalRepository();
const categories = new PrismaServiceCategoryRepository();
const users = new PrismaUserRepository();
const addresses = new PrismaAddressRepository();
// Module 27 — Spain Location Services: the same shared, factory-resolved
// GeocodingProvider instance every composition root uses — see
// geolocation/compose.ts.
const geocoding = geocodingProvider;

export function makeCreateProfessionalUseCase() {
  return new CreateProfessionalUseCase(professionals, categories);
}

/**
 * Professional Onboarding — reuses the exact same `CreateProfessionalUseCase`
 * instance/wiring as `makeCreateProfessionalUseCase()` above; this is
 * composition, not a second implementation. See
 * CompleteProfessionalOnboardingUseCase's own doc comment.
 */
export function makeCompleteProfessionalOnboardingUseCase() {
  return new CompleteProfessionalOnboardingUseCase(
    users,
    addresses,
    geocoding,
    makeCreateProfessionalUseCase(),
  );
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
