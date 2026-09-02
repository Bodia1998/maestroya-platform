import { PrismaAddressRepository } from "@/infrastructure/database/prisma/repositories/prisma-address-repository";
/**
 * Module 47 — CQRS Search Engine: the shared platform `eventBus`, injected
 * so the lifecycle events this module's use cases now publish actually
 * reach the search-indexing subscribers (they default to a `NullEventBus`
 * when constructed directly, e.g. in unit tests). Importing
 * `infrastructure/search/compose` here is what guarantees those
 * subscribers are registered for *this* flow even if `instrumentation.ts`'s
 * boot-time import hasn't run — the same defensive-import convention
 * `admin/compose.ts` already documents for its own subscribers.
 */
import { eventBus } from "@/infrastructure/events/compose";
import "@/infrastructure/search/compose";

import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { CompleteProfessionalOnboardingUseCase } from "@/application/use-cases/professional/complete-professional-onboarding.use-case";
import { makeCollectFraudTrustSignalsUseCase } from "@/application/use-cases/trust-integrity/compose";
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
  return new CreateProfessionalUseCase(professionals, categories, eventBus);
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
    // Module 93 — Real Fraud & Trust Signal Providers: see that use
    // case's own doc comment on this optional constructor argument.
    makeCollectFraudTrustSignalsUseCase(),
  );
}

export function makeGetProfessionalUseCase() {
  return new GetProfessionalUseCase(professionals);
}

export function makeGetProfessionalByUserIdUseCase() {
  return new GetProfessionalByUserIdUseCase(professionals);
}

export function makeUpdateProfessionalUseCase() {
  return new UpdateProfessionalUseCase(professionals, eventBus);
}

export function makeDeactivateProfessionalUseCase() {
  return new DeactivateProfessionalUseCase(professionals, eventBus);
}

export function makeUpdateProfessionalServicesUseCase() {
  return new UpdateProfessionalServicesUseCase(professionals, categories, eventBus);
}
