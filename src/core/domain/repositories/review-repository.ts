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

import type { RatingDistribution } from "@/domain/services/review-rules";

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
  /** Module 41 — Reviews & Ratings: the reviewed professional's own reply,
   *  and when it was last written. Both were already present on the
   *  Prisma schema (added in Module 13's own migration, unused until now —
   *  see schema.prisma's Review model doc comment) — no new column was
   *  needed to add this feature. `respondedAt` is set the first time a
   *  response is posted and updated again on every edit (RespondToReviewUseCase),
   *  so it always reflects "last responded at", not "first responded at";
   *  the audit log (RecordReviewResponseAddedAuditLogSubscriber) is the
   *  place the full edit history is preserved. */
  response: string | null;
  respondedAt: Date | null;
  /** Module 41 — Reviews & Ratings: soft delete by the review's own
   *  author (DeleteReviewUseCase) — distinct from `status`, which remains
   *  Module 16 Admin Panel's moderation axis (PENDING/PUBLISHED/FLAGGED/
   *  REMOVED). A non-null `deletedAt` excludes the review from every
   *  public/read surface (see PrismaReviewRepository's filters) while
   *  preserving the row itself for audit purposes, same "soft delete,
   *  never hard delete" convention as CompanyMembership.removedAt. */
  deletedAt: Date | null;
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
 *  empty is the clearer contract either way.
 *
 *  Module 41 — Reviews & Ratings: `ratingDistribution` and `lastReviewAt`
 *  are additive fields (existing callers destructuring only
 *  `averageRating`/`reviewCount` are unaffected — see this module's own
 *  "API Compatibility" notes). Both are computed by
 *  PrismaReviewRepository.getProfessionalRatingSummary in the *same* single
 *  `groupBy` query as `averageRating`/`reviewCount` — see that method's own
 *  doc comment for why this stays one query, not four. */
export interface ProfessionalRatingSummary {
  professionalProfileId: string;
  averageRating: number | null;
  reviewCount: number;
  /** Count of PUBLISHED, non-deleted reviews per star rating (1–5),
   *  zero-filled — a rating with no reviews is `0`, never a missing key. */
  ratingDistribution: RatingDistribution;
  /** `createdAt` of the most recent PUBLISHED, non-deleted review, or
   *  `null` when `reviewCount` is 0. */
  lastReviewAt: Date | null;
}

export interface ListProfessionalReviewsOptions {
  limit: number;
  offset: number;
  /** Module 41 — Reviews & Ratings: optional exact-rating filter (1–5) for
   *  the public listing — e.g. "show only 5-star reviews". `undefined`
   *  (the default) returns every rating, identical to this option's
   *  pre-Module-41 behavior. */
  rating?: number;
}

export interface UpdateReviewData {
  rating: number;
  comment: string | null;
}

export interface ReviewRepository {
  findById(id: string): Promise<ReviewRecord | null>;

  /** At most one row can ever match — `jobId` is unique at the DB level
   *  (see schema.prisma). Used both to serve "the review for this job" and
   *  as the pre-write existence check CreateReviewUseCase performs before
   *  calling `create` (the DB unique constraint is the final concurrency
   *  guarantee behind that check — see PrismaReviewRepository.create's doc
   *  comment). Returns a soft-deleted review too (same as `findById`) —
   *  callers that must exclude soft-deleted rows (e.g. re-deriving "does a
   *  review already exist for this job") check `deletedAt` themselves,
   *  same convention as every other soft-delete field in this codebase. */
  findByJobId(jobId: string): Promise<ReviewRecord | null>;

  /** Public-visibility listing for a professional's reviews (their profile
   *  page) — only ever returns PUBLISHED, non-deleted reviews (see the
   *  status/deletedAt filters' doc comment on the Prisma implementation),
   *  filtered the same way discovery/listing repositories elsewhere in this
   *  codebase filter at the query level rather than in the use case.
   *  Deterministically ordered newest-first (`createdAt desc, id desc` —
   *  see PrismaReviewRepository, same tiebreak convention as every other
   *  paginated listing in this codebase). */
  listByProfessionalId(
    professionalProfileId: string,
    options: ListProfessionalReviewsOptions,
  ): Promise<ReviewRecord[]>;

  /** Average rating + count + distribution for a professional, computed
   *  from actual PUBLISHED, non-deleted reviews at read time — never a
   *  denormalized stored average (see this module's documentation for
   *  why). */
  getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary>;

  /**
   * Creates the Review. Implementations MUST translate a DB unique
   * constraint violation on `jobId` (a second review landing concurrently
   * for the same Job) into a `ConflictError` rather than letting a raw
   * Prisma error escape — see PrismaReviewRepository.create's doc comment.
   */
  create(data: CreateReviewData): Promise<ReviewRecord>;

  /** Module 41 — Reviews & Ratings: overwrites `rating`/`comment` on an
   *  existing review (UpdateReviewUseCase already re-validated the edit
   *  window and ownership before calling this) and bumps `updatedAt`.
   *  Returns `null` if `id` doesn't exist — mirrors
   *  AdminRepository.setReviewStatus's own "null means not found, let the
   *  use case decide the error" convention rather than throwing here. */
  update(id: string, data: UpdateReviewData): Promise<ReviewRecord | null>;

  /** Module 41 — Reviews & Ratings: sets `deletedAt` to now (soft delete —
   *  see ReviewRecord.deletedAt's own doc comment). Returns `null` if `id`
   *  doesn't exist. */
  softDelete(id: string): Promise<ReviewRecord | null>;

  /** Module 41 — Reviews & Ratings: sets/overwrites `response` and bumps
   *  `respondedAt` to now (RespondToReviewUseCase already re-validated
   *  that the caller is the reviewed professional). Returns `null` if `id`
   *  doesn't exist. */
  respond(id: string, response: string): Promise<ReviewRecord | null>;
}
