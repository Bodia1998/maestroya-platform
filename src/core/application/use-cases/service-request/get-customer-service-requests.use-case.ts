import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

/**
 * Lists the *authenticated* customer's own ServiceRequests only. `userId`
 * must come from the server-side session — there is no id parameter here
 * to trust or distrust, which is itself the guarantee: this use case has no
 * way to return anyone else's requests.
 *
 * A user with no CustomerProfile yet (never created a request) simply gets
 * an empty list rather than an error — a perfectly valid "no requests yet"
 * state, same spirit as GetProfessionalByUserIdUseCase returning null.
 */
export class GetCustomerServiceRequestsUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(userId: string): Promise<ServiceRequestRecord[]> {
    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      return [];
    }
    return this.serviceRequests.findManyByCustomerId(customer.id);
  }
}
