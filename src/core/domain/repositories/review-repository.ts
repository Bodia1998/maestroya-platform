/**
 * Reviews & Ratings module (Module 13): repository interface for the
 * Review aggregate. Follows the same "record + narrow repository
 * interface" convention already used by JobRepository/AppointmentRepository
 * — there is no `Entity<Props>` subclass for Review, mirroring the fact
 * that Job itself has no Entity subclass either (see job-repository.ts):
 * this codebase keeps pure business rules in small dependency-free
 * `domain/services/*.ts` helpers (see review-rules.ts) rather than in an
 * OOP entity class, and this file only defines the shape data is read/
 * written in.
 *
 * A Review is always created anchored to a Job (`jobId`, unique — see
 * schema.prisma's Review model doc comment for why Job, not
 * ServiceRequest/Quote, is authoritative). Review creation itself is not
 * exposed as a generic "update" method — same "narrow, purpose-built
 * methods" convention as JobRepository's startWork/complete/cancel.
 */

export type ReviewStatusValue = "PENDING" | "PUBLISHED" | "FLAGGED" | "REMOVED";

export interface ReviewRecord {
  id: string;
  jobId: string;
  serviceRequestId: string;
  /** User.id of the review's author — always the Job's customer, resolved
   *  server-side via resolveJobActor, never a client-supplied id. */
  reviewerId: string;
  /** Exactly one of these two is set — mirrors Quote/Payout's own
   *  solo-professional-vs-company duality. This codebase only supports
   *  solo professionals end-to-end today (see resolveJobActor's own doc
   *  comment), so Module 13 only ever populates
   *  revieweeProfessionalProfileId; the company field exists so a future
   *  module can populate it without a schema change. */
  revieweeProfessionalProfileId: string | null;
  revieweeCompanyProfileId: string | null;
  rating: number;
  comment: string | null;
  status: ReviewStatusValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReviewData {
  jobId: string;
  serviceRequestId: string;
  reviewerId: string;
  revieweeProfessionalProfileId: string | null;
  revieweeCompanyProfileId: string | null;
  rating: number;
  comment: string | null;
}

/** Cheap aggregate used both for a professional's public rating display and
 *  as the seam a future Module 19 — Search & Ranking can read from without
 *  Review depending on that module (see this file's own top doc comment).
 *  `averageRating` is `null` (not 0) when `reviewCount` is 0 — "no reviews
 *  yet" is a distinct state from "reviews exist and average 0", which can
 *  never actually happen given the 1–5 rating range anyway, but null-for-
 *  empty is the clearer contract either way. */
export interface ProfessionalRatingSummary {
  professionalProfileId: string;
  averageRating: number | null;
  reviewCount: number;
}

export interface ListProfessionalReviewsOptions {
  limit: number;
  offset: number;
}

export interface ReviewRepository {
  findById(id: string): Promise<ReviewRecord | null>;

  /** At most one row can ever match — `jobId` is unique at the DB level
   *  (see schema.prisma). Used both to serve "the review for this job" and
   *  as the pre-write existence check CreateReviewUseCase performs before
   *  calling `create` (the DB unique constraint is the final concurrency
   *  guarantee behind that check — see PrismaReviewRepository.create's doc
   *  comment). */
  findByJobId(jobId: string): Promise<ReviewRecord | null>;

  /** Public-visibility listing for a professional's reviews (their profile
   *  page) — only ever returns PUBLISHED reviews (see the status filter's
   *  doc comment on the Prisma implementation), oldest exclusions handled
   *  the same way discovery/listing repositories elsewhere in this codebase
   *  filter at the query level rather than in the use case. */
  listByProfessionalId(
    professionalProfileId: string,
    options: ListProfessionalReviewsOptions,
  ): Promise<ReviewRecord[]>;

  /** Average rating + count for a professional, computed from actual
   *  PUBLISHED reviews — never a denormalized stored average (see this
   *  module's documentation for why). */
  getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary>;

  /**
   * Creates the Review. Implementations MUST translate a DB unique
   * constraint violation on `jobId` (a second review landing concurrently
   * for the same Job) into a `ConflictError` rather than letting a raw
   * Prisma error escape — see PrismaReviewRepository.create's doc comment.
   */
  create(data: CreateReviewData): Promise<ReviewRecord>;
}
