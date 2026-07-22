import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isEditableStatus } from "@/domain/services/service-request-state";

/**
 * Removes a photo from the *authenticated* customer's own ServiceRequest,
 * only while it is in the OPEN-equivalent state (PUBLISHED). The photoId is
 * re-checked against the request's own photo list (not just deleted
 * blindly by id) so one customer can never remove a photo belonging to
 * another customer's request by guessing its id.
 */
export class RemoveServiceRequestPhotoUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(userId: string, requestId: string, photoId: string): Promise<void> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const existing = await this.serviceRequests.findById(requestId);
    if (!existing || existing.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    if (!isEditableStatus(existing.status)) {
      throw new ValidationError("Photos can only be removed while a request is open.");
    }

    const photo = existing.photos.find((p) => p.id === photoId);
    if (!photo) {
      throw new NotFoundError("RequestPhoto", photoId);
    }

    await this.serviceRequests.removePhoto(existing.id, photoId);
  }
}
