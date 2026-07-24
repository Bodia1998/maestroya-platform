import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import { isValidRating, normalizeComment } from "@/domain/services/review-rules";
import { resolveJobActor } from "@/application/use-cases/job/resolve-job-actor";

export interface CreateReviewInput {
  jobId: string;
  rating: number;
  comment: string | null;
}

/**
 * Reviews & Ratings module (Module 13): the only write use case this
 * module exposes — a review, once created, is neither edited nor deleted
 * by its author (see the module's documentation, "Immutability" — no
 * product requirement calls for an edit/delete workflow, and admin
 * moderation/removal belongs to Module 16, not here).
 *
 * The core product rule this enforces end to end: a review may only be
 * created for a Job whose `status` is COMPLETED — never inferred from
 * ServiceRequest or Quote state, and never from a client-supplied flag.
 * Every authoritative fact (who the customer is, who performed the work,
 * whether the job is actually completed) is re-derived from the Job record
 * itself, loaded fresh from `jobs.findById`, exactly like every other
 * Job-touching use case (see CompleteJobUseCase's own doc comment).
 *
 * Authorization reuses resolveJobActor verbatim — the same function every
 * other Job use case uses — so an unrelated user gets the identical
 * NotFoundError a nonexistent Job id would produce (no "exists but isn't
 * yours" probe), and a professional can never pass themselves off as the
 * customer merely by calling this with their own userId (resolveJobActor
 * always re-derives which side, if any, the authenticated user is on).
 *
 * Notifications module (Module 15) integration: Module 13's own
 * documentation explicitly deferred a REVIEW_RECEIVED notification to a
 * future notifications module — this is that wiring. The professional
 * being reviewed (never the reviewer/customer — a review is never
 * self-notifying) gets a REVIEW_RECEIVED notification once the review is
 * successfully persisted. Best-effort: a notification-creation failure is
 * caught, logged, and never rolls back or fails the review itself, same
 * convention as every other notifier call site in this codebase (see
 * StartJobUseCase.execute).
 */
export class CreateReviewUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    // Notifications module (Module 15): Module 13 explicitly deferred a
    // REVIEW_RECEIVED notification to this module — see this class's own
    // doc comment below. Optional, defaults to a no-op — see
    // NullNotificationCreator's own doc comment.
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(userId: string, input: CreateReviewInput): Promise<ReviewRecord> {
    const job = await this.jobs.findById(input.jobId);
    if (!job) {
      throw new NotFoundError("Job", input.jobId);
    }

    // Same authorization primitive every other Job use case uses — an
    // unrelated user (including the job's own professional trying to
    // impersonate the customer) throws NotFoundError here, never a
    // distinguishable "forbidden" response.
    const actor = await resolveJobActor(userId, job, {
      customerProfiles: this.customerProfiles,
      professionals: this.professionals,
    });
    if (actor.role !== "customer") {
      throw new ValidationError("Only the customer can review this job.");
    }

    // The authoritative prerequisite (see this class's own doc comment):
    // Job.status === COMPLETED. Never a Payment.status check — Payment /
    // Stripe Connect (Module 12) is deferred and Reviews must work
    // independently of it.
    if (job.status !== "COMPLETED") {
      throw new ValidationError("This job must be completed before it can be reviewed.");
    }

    // Application-level duplicate check — clear domain error on the common
    // path. The database's unique constraint on Review.jobId (see
    // PrismaReviewRepository.create's doc comment) is the final
    // concurrency guarantee if two requests for the same Job race past
    // this check at the same instant.
    const existing = await this.reviews.findByJobId(input.jobId);
    if (existing) {
      throw new ConflictError("A review already exists for this job.");
    }

    // Defense in depth: the Server Action's DTO (createReviewSchema)
    // already validates this, but the use case is also callable directly
    // (as every test in this codebase does), so the rule is re-checked
    // here too — same "domain rule enforced at both the DTO boundary and
    // the use case" convention as job.dto.ts/CompleteJobUseCase.
    if (!isValidRating(input.rating)) {
      throw new ValidationError("Rating must be a whole number from 1 to 5.");
    }

    // The reviewee is always derived from the Job, never from client
    // input — this is what makes "client-supplied professionalId cannot
    // redirect the review" true by construction rather than by a separate
    // check.
    const review = await this.reviews.create({
      jobId: job.id,
      serviceRequestId: job.serviceRequestId,
      reviewerId: userId,
      revieweeProfessionalProfileId: job.professionalProfileId,
      revieweeCompanyProfileId: job.companyProfileId,
      rating: input.rating,
      comment: normalizeComment(input.comment),
    });

    try {
      if (job.professionalProfileId) {
        const professional = await this.professionals.findById(job.professionalProfileId);
        if (professional) {
          await this.notifications.notify({
            userId: professional.userId,
            type: "REVIEW_RECEIVED",
            title: "You received a new review",
            message: "A customer left a review for your completed job.",
            resourceType: "REVIEW",
            resourceId: review.id,
            actionUrl: `/jobs/${job.id}`,
            metadata: { jobId: job.id, rating: review.rating },
          });
        }
      }
    } catch (error) {
      console.error("Failed to create review-received notification", error);
    }

    return review;
  }
}
