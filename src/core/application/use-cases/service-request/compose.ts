import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
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

import { PrismaServiceCategoryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-category-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { CloudinaryRequestPhotoUploadService } from "@/infrastructure/storage/cloudinary/request-photo-upload-service";
import { AddServiceRequestPhotoUseCase } from "@/application/use-cases/service-request/add-service-request-photo.use-case";
import { CancelServiceRequestUseCase } from "@/application/use-cases/service-request/cancel-service-request.use-case";
import { CreateServiceRequestUseCase } from "@/application/use-cases/service-request/create-service-request.use-case";
import { GetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/get-customer-service-requests.use-case";
import { GetServiceRequestUseCase } from "@/application/use-cases/service-request/get-service-request.use-case";
import { RemoveServiceRequestPhotoUseCase } from "@/application/use-cases/service-request/remove-service-request-photo.use-case";
import { UpdateServiceRequestUseCase } from "@/application/use-cases/service-request/update-service-request.use-case";
import { geocodingProvider } from "@/application/use-cases/geolocation/compose";

const serviceRequests = new PrismaServiceRequestRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const categories = new PrismaServiceCategoryRepository();
const photoUploadService = new CloudinaryRequestPhotoUploadService();
// Same GeocodingProvider seam/implementation CompleteProfessionalOnboardingUseCase
// already uses for the professional's own base location — see
// CreateServiceRequestUseCase's doc comment for why a ServiceRequest needs
// this too. Module 27 — Spain Location Services: shared, factory-resolved
// instance — see geolocation/compose.ts.
const geocoding = geocodingProvider;

export function makeCreateServiceRequestUseCase() {
  return new CreateServiceRequestUseCase(serviceRequests, customerProfiles, categories, geocoding);
}

export function makeGetServiceRequestUseCase() {
  return new GetServiceRequestUseCase(serviceRequests, customerProfiles);
}

export function makeGetCustomerServiceRequestsUseCase() {
  return new GetCustomerServiceRequestsUseCase(serviceRequests, customerProfiles);
}

export function makeUpdateServiceRequestUseCase() {
  return new UpdateServiceRequestUseCase(serviceRequests, customerProfiles, categories, geocoding, eventBus);
}

export function makeCancelServiceRequestUseCase() {
  return new CancelServiceRequestUseCase(serviceRequests, customerProfiles);
}

export function makeAddServiceRequestPhotoUseCase() {
  return new AddServiceRequestPhotoUseCase(serviceRequests, customerProfiles, photoUploadService);
}

export function makeRemoveServiceRequestPhotoUseCase() {
  return new RemoveServiceRequestPhotoUseCase(serviceRequests, customerProfiles);
}
