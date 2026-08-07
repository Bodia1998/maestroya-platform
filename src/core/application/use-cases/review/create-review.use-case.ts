import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ReviewCreated } from "@/domain/events/review-created";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import { isValidRating, normalizeComment } from "@/domain/services/review-rules";
import { resolveJobActor } from "@/application/use-cases/job/resolve-job-actor";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface CreateReviewInput {
  jobId: string;
  rating: number;
  comment: string | null;
}

/**
 * Reviews & Ratings module (Module 13, extended by Module 41): creates a
 * review for a completed Job. A review, once created, may later be edited
 * (`UpdateReviewUseCase`) or soft-deleted (`DeleteReviewUseCase`) by its
 * author within the rules `review-rules.ts` defines — see those use cases'
 * own doc comments; this class only covers creation.
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
 * Module 41 — Domain Event Integration: this use case no longer calls
 * `NotificationCreator` directly (Module 13's original implementation did).
 * It now publishes `ReviewCreated` through the Module 34 `EventBus`
 * instead — exactly the "publish, don't call directly" pattern
 * `CreateDisputeUseCase` established (see that class's own doc comment,
 * mirrored verbatim below down to the publish-and-report, never-rethrow
 * error handling). `NotifyReviewCreatedSubscriber` (Notifications) and
 * `RecordReviewCreatedAuditLogSubscriber` (Audit Log) both react to the
 * same event; neither is called from here.
 */
export class CreateReviewUseCase {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
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

    let revieweeUserId: string | null = null;
    if (job.professionalProfileId) {
      const professional = await this.professionals.findById(job.professionalProfileId);
      revieweeUserId = professional?.userId ?? null;
    }

    // Publish-and-report, never rethrow — a failing subscriber (an email
    // provider outage, an audit-log write failure) must never roll back or
    // fail the review itself, same contract every other event-publishing
    // use case in this codebase follows (see CreateDisputeUseCase.execute).
    try {
      await this.eventBus.publishAll([new ReviewCreated(review.id, job.id, userId, revieweeUserId, review.rating)]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return review;
  }
}
