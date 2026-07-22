import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import { isEditableStatus } from "@/domain/services/service-request-state";
import type { UpdateServiceRequestInput } from "@/application/dto/service-request.dto";

/**
 * Updates the *authenticated* customer's own ServiceRequest — looked up by
 * requestId, but ownership is always checked against the session's own
 * CustomerProfile, never trusted from the client. Only requests in the
 * OPEN-equivalent state (PUBLISHED — see service-request-state.ts) can be
 * edited; every other status (including CANCELLED) rejects the edit with a
 * ValidationError, enforced here in the use-case layer so no UI path can
 * bypass it.
 *
 * Photo add/remove are deliberately separate use cases
 * (AddServiceRequestPhotoUseCase/RemoveServiceRequestPhotoUseCase) rather
 * than fields on this input — same separation as the Profile module keeping
 * avatar upload separate from UpdateProfileUseCase.
 */
export class UpdateServiceRequestUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(
    userId: string,
    requestId: string,
    input: UpdateServiceRequestInput,
  ): Promise<ServiceRequestRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const existing = await this.serviceRequests.findById(requestId);
    if (!existing || existing.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    if (!isEditableStatus(existing.status)) {
      throw new ValidationError("Only open requests can be edited.");
    }

    let categoryId = existing.categoryId;
    if (input.categoryId && input.categoryId !== existing.categoryId) {
      const [category] = await this.categories.findActiveByIds([input.categoryId]);
      if (!category) {
        throw new ValidationError("Selected service category is invalid or inactive.");
      }
      categoryId = category.id;
    }

    const budgetMin = input.budgetMin !== undefined ? input.budgetMin : existing.budgetMin;
    const budgetMax = input.budgetMax !== undefined ? input.budgetMax : existing.budgetMax;
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      throw new ValidationError("Minimum budget must not exceed maximum budget.");
    }

    return this.serviceRequests.update(existing.id, {
      categoryId,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      urgency: input.urgency ?? existing.urgency,
      budgetMin,
      budgetMax,
      location: input.location
        ? {
            line1: input.location.line1,
            line2: input.location.line2 || null,
            city: input.location.city,
            province: input.location.province || null,
            postalCode: input.location.postalCode,
            country: input.location.country,
            latitude: input.location.latitude ?? null,
            longitude: input.location.longitude ?? null,
          }
        : existing.location,
    });
  }
}
