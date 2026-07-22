import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { RequestPhotoRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isEditableStatus } from "@/domain/services/service-request-state";
import { MAX_PHOTOS_PER_REQUEST } from "@/application/dto/service-request.dto";
import type { RequestPhotoUploadService } from "@/application/interfaces/request-photo-upload-service";

/**
 * Adds a photo to the *authenticated* customer's own ServiceRequest, only
 * while it is in the OPEN-equivalent state (PUBLISHED) and only up to
 * MAX_PHOTOS_PER_REQUEST — enforced here, not just in the upload form, so
 * no other caller can bypass the limit. Reuses the same Cloudinary upload
 * mechanism as avatar upload (see RequestPhotoUploadService / the
 * Cloudinary implementation), just against a different folder/entity.
 */
export class AddServiceRequestPhotoUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly photoUploadService: RequestPhotoUploadService,
  ) {}

  async execute(
    userId: string,
    requestId: string,
    fileBuffer: Buffer,
    contentType: string,
    caption: string | null = null,
  ): Promise<RequestPhotoRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const existing = await this.serviceRequests.findById(requestId);
    if (!existing || existing.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    if (!isEditableStatus(existing.status)) {
      throw new ValidationError("Photos can only be added while a request is open.");
    }

    const photoCount = await this.serviceRequests.countPhotos(existing.id);
    if (photoCount >= MAX_PHOTOS_PER_REQUEST) {
      throw new ValidationError(`You can attach up to ${MAX_PHOTOS_PER_REQUEST} photos per request.`);
    }

    const url = await this.photoUploadService.uploadRequestPhoto(existing.id, fileBuffer, contentType);
    return this.serviceRequests.addPhoto(existing.id, url, caption || null);
  }
}
