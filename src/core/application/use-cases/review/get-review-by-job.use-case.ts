import { NotFoundError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import { resolveJobActor } from "@/application/use-cases/job/resolve-job-actor";

/**
 * Reviews & Ratings module (Module 13): fetches the review for one Job (if
 * any) for the two people who always have a right to see it regardless of
 * public-visibility status — the Job's customer (who wrote it) and the
 * Job's professional (who received it). Authorization mirrors GetJobUseCase
 * exactly: an unrelated user gets the same NotFoundError a nonexistent Job
 * id would produce.
 *
 * Returns `null` (not an error) when the Job has no review yet — "no
 * review" is an expected, common state, not a failure.
 */
export class GetReviewByJobUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string, jobId: string): Promise<ReviewRecord | null> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });

    return this.reviews.findByJobId(jobId);
  }
}
