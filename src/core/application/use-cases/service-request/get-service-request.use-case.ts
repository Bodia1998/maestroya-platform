import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

/**
 * Fetches a single ServiceRequest, but *only* through the owning
 * customer's own session — this is the customer-facing path only. There is
 * deliberately no professional-visibility path implemented by this use
 * case (a future module will add one with its own, much narrower, public
 * shape of the data).
 *
 * `userId` must come from the server-side session, never a client-supplied
 * customerId. A request that exists but belongs to a different customer is
 * surfaced as the exact same NotFoundError as a request that doesn't exist
 * at all — this is deliberate: it must never be possible to distinguish
 * "not yours" from "doesn't exist" from the outside, so one customer can't
 * probe for the existence of another's requests.
 */
export class GetServiceRequestUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(userId: string, requestId: string): Promise<ServiceRequestRecord> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    const request = await this.serviceRequests.findById(requestId);
    if (!request || request.customerId !== customer.id) {
      throw new NotFoundError("ServiceRequest", requestId);
    }

    return request;
  }
}
