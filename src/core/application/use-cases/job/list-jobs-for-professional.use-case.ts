import { ValidationError } from "@/domain/errors/domain-error";
import type { JobRepository, JobSummary } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Order / Job Lifecycle module (Module 11): "my jobs" for the signed-in
 * solo professional — mirrors ListAppointmentsForProfessionalUseCase.
 * Company-owned jobs are out of scope for this list, same limitation as
 * the Booking module's equivalent.
 */
export class ListJobsForProfessionalUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly professionals: ProfessionalRepository,
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

    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      return [];
    }

    return this.jobs.listForProfessional(professional.id, { filter, limit, offset });
  }
}
