import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { CANCELLED_STATUS, isCancellableStatus } from "@/domain/services/service-request-state";

/**
 * Cancels the *authenticated* customer's own ServiceRequest
 * (status -> CANCELLED). Looked up by requestId, ownership checked against
 * the session's own CustomerProfile — never a client-supplied customerId.
 * Only requests in the OPEN-equivalent state (PUBLISHED) can be cancelled;
 * an already-CANCELLED (or any other non-cancellable status) request
 * rejects with a ValidationError rather than silently no-op'ing, so the UI
 * can give clear feedback — same pattern as DeactivateProfessionalUseCase.
 */
export class CancelServiceRequestUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(userId: string, requestId: string): Promise<void> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const existing = await this.serviceRequests.findById(requestId);
    if (!existing || existing.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    if (!isCancellableStatus(existing.status)) {
      throw new ValidationError("Only open requests can be cancelled.");
    }

    await this.serviceRequests.updateStatus(existing.id, CANCELLED_STATUS);
  }
}
