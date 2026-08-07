import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import { emptyRatingDistribution } from "@/domain/services/review-rules";
import type {
  CreateReviewData,
  ListProfessionalReviewsOptions,
  ProfessionalRatingSummary,
  ReviewRecord,
  ReviewRepository,
  ReviewStatusValue,
  UpdateReviewData,
} from "@/domain/repositories/review-repository";

const DETAIL_SELECT = {
  id: true,
  jobId: true,
  serviceRequestId: true,
  reviewerId: true,
  revieweeProfessionalProfileId: true,
  revieweeCompanyProfileId: true,
  rating: true,
  comment: true,
  status: true,
  response: true,
  respondedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaReviewRow = {
  id: string;
  jobId: string;
  serviceRequestId: string;
  reviewerId: string;
  revieweeProfessionalProfileId: string | null;
  revieweeCompanyProfileId: string | null;
  rating: number;
  comment: string | null;
  status: string;
  response: string | null;
  respondedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PrismaReviewRow): ReviewRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    serviceRequestId: row.serviceRequestId,
    reviewerId: row.reviewerId,
    revieweeProfessionalProfileId: row.revieweeProfessionalProfileId,
    revieweeCompanyProfileId: row.revieweeCompanyProfileId,
    rating: row.rating,
    comment: row.comment,
    status: row.status as ReviewStatusValue,
    response: row.response,
    respondedAt: row.respondedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Reviews & Ratings module (Module 13, extended by Module 41): only
 *  PUBLISHED, non-deleted reviews are ever surfaced through public-facing
 *  reads (listing for a professional, rating aggregation) — FLAGGED/REMOVED
 *  are excluded the same way a Module 16 moderation action expects, and a
 *  review the author has soft-deleted (Module 41 — see
 *  ReviewRecord.deletedAt's own doc comment) is excluded the same way.
 *  `findById`/`findByJobId` deliberately do NOT apply either filter — the
 *  Job's own participants (reviewer, reviewee) can always see their own
 *  review regardless of moderation/deletion status; only the public
 *  professional-facing surfaces filter. */
const PUBLIC_STATUS: ReviewStatusValue = "PUBLISHED";
const PUBLIC_WHERE = { status: PUBLIC_STATUS, deletedAt: null } as const;

/**
 * Reviews & Ratings module (Module 13, extended by Module 41): Prisma
 * implementation of ReviewRepository. Follows the same shape as
 * PrismaJobRepository — narrow SELECTs, plain-object mapping, no Prisma
 * types leaking past this file.
 */
export class PrismaReviewRepository implements ReviewRepository {
  async findById(id: string): Promise<ReviewRecord | null> {
    const row = await prisma.review.findUnique({ where: { id }, select: DETAIL_SELECT });
    return row ? toRecord(row) : null;
  }

  async findByJobId(jobId: string): Promise<ReviewRecord | null> {
    const row = await prisma.review.findUnique({ where: { jobId }, select: DETAIL_SELECT });
    return row ? toRecord(row) : null;
  }

  async listByProfessionalId(
    professionalProfileId: string,
    options: ListProfessionalReviewsOptions,
  ): Promise<ReviewRecord[]> {
    const rows = await prisma.review.findMany({
      where: {
        revieweeProfessionalProfileId: professionalProfileId,
        ...PUBLIC_WHERE,
        ...(options.rating !== undefined ? { rating: options.rating } : {}),
      },
      select: DETAIL_SELECT,
      // Deterministic newest-first ordering — `createdAt` alone does not
      // guarantee a stable order for two rows created in the same
      // millisecond; `id desc` breaks ties the same way every other
      // paginated listing in this codebase does (see
      // PrismaAdminAuditLogRepository.list's identical comment).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  /**
   * Module 41 — Reviews & Ratings: average, count, distribution, and
   * last-review timestamp for a professional, computed in a **single**
   * `groupBy` query rather than one `aggregate` call per statistic. Prisma
   * has no single call that returns avg+count+max grouped *and* ungrouped
   * at once, but grouping by `rating` (at most 5 groups — the whole rating
   * scale) and requesting `_count` and `_max.createdAt` per group gives
   * everything this method needs: the distribution *is* the per-group
   * counts, the overall count is their sum, the overall average is derived
   * from `sum(rating * count) / count` (exact — no floating-point
   * accumulation the way summing individual ratings client-side could
   * introduce), and the overall last-review date is the max of each
   * group's own max. This is the "avoid unnecessary DB queries" requirement
   * this module calls out explicitly — a naive implementation would need
   * one `aggregate` (avg+count) plus five `count` calls (one per rating)
   * plus one more `aggregate` (max createdAt): seven round trips, now one.
   */
  async getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    const groups = await prisma.review.groupBy({
      by: ["rating"],
      where: { revieweeProfessionalProfileId: professionalProfileId, ...PUBLIC_WHERE },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const ratingDistribution = emptyRatingDistribution();
    let reviewCount = 0;
    let ratingSum = 0;
    let lastReviewAt: Date | null = null;

    for (const group of groups) {
      const rating = group.rating as 1 | 2 | 3 | 4 | 5;
      const count = group._count._all;
      ratingDistribution[rating] = count;
      reviewCount += count;
      ratingSum += rating * count;
      const groupMax = group._max.createdAt;
      if (groupMax && (!lastReviewAt || groupMax > lastReviewAt)) {
        lastReviewAt = groupMax;
      }
    }

    // Rounded to 1 decimal place — ratings are always whole numbers 1-5, so
    // a fixed single-decimal average (e.g. 4.3) is the natural display
    // precision; avoids the floating-point drift a raw division could
    // otherwise show (see money.ts's own "round at every arithmetic step"
    // convention, applied here to the one place this module does division).
    const averageRating = reviewCount === 0 ? null : Math.round((ratingSum / reviewCount) * 10) / 10;

    return { professionalProfileId, averageRating, reviewCount, ratingDistribution, lastReviewAt };
  }

  /**
   * Creates the Review. `jobId` is unique at the DB level (see
   * schema.prisma) — this is the final concurrency guarantee behind "one
   * review per Job", enforced even if two requests for the same Job race
   * past CreateReviewUseCase's own pre-write existence check at the same
   * instant. A unique-constraint violation here (Prisma error code P2002)
   * is translated into a ConflictError rather than letting the raw Prisma
   * error escape the application boundary — mirrors how every other
   * repository in this codebase (e.g. PrismaJobRepository.complete) never
   * lets a raw persistence error leak past itself.
   */
  async create(data: CreateReviewData): Promise<ReviewRecord> {
    try {
      const row = await prisma.review.create({
        data: {
          jobId: data.jobId,
          serviceRequestId: data.serviceRequestId,
          reviewerId: data.reviewerId,
          revieweeProfessionalProfileId: data.revieweeProfessionalProfileId,
          revieweeCompanyProfileId: data.revieweeCompanyProfileId,
          rating: data.rating,
          comment: data.comment,
        },
        select: DETAIL_SELECT,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("A review already exists for this job.");
      }
      throw error;
    }
  }

  /** Module 41 — Reviews & Ratings: `updateMany` (not `update`) so a
   *  missing `id` resolves to `count: 0` rather than throwing Prisma's own
   *  P2025 "record not found" error — this repository never lets a raw
   *  Prisma error escape it (see `create`'s own doc comment), and
   *  translating "not found" into `null` here keeps that same contract
   *  without a try/catch. */
  async update(id: string, data: UpdateReviewData): Promise<ReviewRecord | null> {
    const result = await prisma.review.updateMany({
      where: { id },
      data: { rating: data.rating, comment: data.comment },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async softDelete(id: string): Promise<ReviewRecord | null> {
    const result = await prisma.review.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async respond(id: string, response: string): Promise<ReviewRecord | null> {
    const result = await prisma.review.updateMany({
      where: { id },
      data: { response, respondedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}
