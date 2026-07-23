import { ValidationError } from "@/domain/errors/domain-error";
import type { JobRepository, JobSummary } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Order / Job Lifecycle module (Module 11): "my jobs" for the signed-in
 * customer — mirrors ListAppointmentsForCustomerUseCase exactly. `userId`
 * always comes from the server-side session and is resolved to the
 * caller's own CustomerProfile; a signed-in user with no CustomerProfile
 * yet simply has no jobs — returns an empty list rather than an error.
 */
export class ListJobsForCustomerUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
  ) {}

  async execute(
    userId: string,
    filter: "active" | "completed" | "cancelled" | undefined,
    page: { limit?: number; offset?: number } = {},
  ): Promise<JobSummary[]> {
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

    return this.jobs.listForCustomer(customer.id, { filter, limit, offset });
  }
}
