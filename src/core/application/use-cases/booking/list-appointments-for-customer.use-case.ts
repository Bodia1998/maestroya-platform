import { ValidationError } from "@/domain/errors/domain-error";
import type { AppointmentRepository, AppointmentSummary } from "@/domain/repositories/appointment-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Booking & Scheduling module (Module 10): "my appointments" for the
 * signed-in customer. `userId` always comes from the server-side session
 * and is resolved to the caller's own CustomerProfile — there is no way to
 * pass a different customer's id and see their appointments (same
 * convention as GetServiceRequestQuotesUseCase et al.). A signed-in user
 * with no CustomerProfile yet simply has no appointments — this returns an
 * empty list rather than an error, since "you have no ServiceRequests" is
 * a completely ordinary state, not an error condition.
 */
export class ListAppointmentsForCustomerUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(
    userId: string,
    filter: "upcoming" | "past" | "cancelled" | undefined,
    page: { limit?: number; offset?: number } = {},
  ): Promise<AppointmentSummary[]> {
    const limit = page.limit ?? DEFAULT_PAGE_SIZE;
    const offset = page.offset ?? 0;
    if (limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    if (offset < 0) {
      throw new ValidationError("offset cannot be negative.");
    }

    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      return [];
    }

    return this.appointments.listForCustomer(customer.id, { filter, limit, offset });
  }
}
