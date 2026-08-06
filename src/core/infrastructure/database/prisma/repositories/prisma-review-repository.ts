import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type {
  CreateReviewData,
  ListProfessionalReviewsOptions,
  ProfessionalRatingSummary,
  ReviewRecord,
  ReviewRepository,
  ReviewStatusValue,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Reviews & Ratings module (Module 13): only PUBLISHED reviews are ever
 *  surfaced through public-facing reads (listing for a professional, rating
 *  aggregation) — FLAGGED/REMOVED are excluded the same way a future
 *  Module 16 moderation action would expect, and PENDING never occurs in
 *  practice since Module 13 creates reviews as PUBLISHED directly (see
 *  schema.prisma's Review model doc comment). `findByJobId` deliberately
 *  does NOT apply this filter — the Job's own participants (reviewer,
 *  reviewee) can always see their own review regardless of moderation
 *  status; only the public professional-facing surfaces filter. */
const PUBLIC_STATUS: ReviewStatusValue = "PUBLISHED";

/**
 * Reviews & Ratings module (Module 13): Prisma implementation of
 * ReviewRepository. Follows the same shape as PrismaJobRepository —
 * narrow SELECTs, plain-object mapping, no Prisma types leaking past this
 * file.
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
      where: { revieweeProfessionalProfileId: professionalProfileId, status: PUBLIC_STATUS },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toRecord);
  }

  async getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    const result = await prisma.review.aggregate({
      where: { revieweeProfessionalProfileId: professionalProfileId, status: PUBLIC_STATUS },
      _avg: { rating: true },
      _count: { _all: true },
    });

    const reviewCount = result._count._all;
    // Rounded to 1 decimal place — ratings are always whole numbers 1-5, so
    // a fixed single-decimal average (e.g. 4.3) is the natural display
    // precision; avoids the floating-point drift a raw division could
    // otherwise show (see money.ts's own "round at every arithmetic step"
    // convention, applied here to the one place this module does division).
    const averageRating =
      reviewCount === 0 || result._avg.rating === null ? null : Math.round(result._avg.rating * 10) / 10;

    return { professionalProfileId, averageRating, reviewCount };
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
}
