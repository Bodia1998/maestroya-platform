import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
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

const serviceRequests = new PrismaServiceRequestRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const categories = new PrismaServiceCategoryRepository();
const photoUploadService = new CloudinaryRequestPhotoUploadService();

export function makeCreateServiceRequestUseCase() {
  return new CreateServiceRequestUseCase(serviceRequests, customerProfiles, categories);
}

export function makeGetServiceRequestUseCase() {
  return new GetServiceRequestUseCase(serviceRequests, customerProfiles);
}

export function makeGetCustomerServiceRequestsUseCase() {
  return new GetCustomerServiceRequestsUseCase(serviceRequests, customerProfiles);
}

export function makeUpdateServiceRequestUseCase() {
  return new UpdateServiceRequestUseCase(serviceRequests, customerProfiles, categories);
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
