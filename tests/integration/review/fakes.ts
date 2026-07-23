import { ConflictError } from "@/domain/errors/domain-error";
import type {
  CreateReviewData,
  ListProfessionalReviewsOptions,
  ProfessionalRatingSummary,
  ReviewRecord,
  ReviewRepository,
} from "@/domain/repositories/review-repository";

/**
 * In-memory test double for the Reviews & Ratings module, following the
 * same pattern as every other module's fakes.ts (see
 * tests/integration/booking/fakes.ts's own doc comment): implements the
 * real ReviewRepository interface so CreateReviewUseCase/GetReviewByJobUseCase/
 * etc. run their genuine orchestration/authorization logic, with only
 * storage swapped out.
 *
 * Mirrors PrismaReviewRepository's two safety properties so tests exercise
 * real behavior, not a stub that always succeeds:
 *   1. `findByJobId` enforces at most one row per Job (a Map keyed by
 *      review id, filtered by jobId — same shape as the real unique index).
 *   2. `create` throws ConflictError if a row for that `jobId` already
 *      exists — the in-memory equivalent of the DB unique-constraint
 *      violation PrismaReviewRepository.create translates from Prisma's
 *      P2002. Every precondition is checked *before* any mutation, so two
 *      concurrent `create` calls racing through this fake behave the same
 *      way two concurrent requests racing through the real transactional
 *      unique index would: exactly one wins.
 */
export class FakeReviewRepository implements ReviewRepository {
  private reviews = new Map<string, ReviewRecord>();
  private idCounter = 0;

  async findById(id: string): Promise<ReviewRecord | null> {
    return this.reviews.get(id) ?? null;
  }

  async findByJobId(jobId: string): Promise<ReviewRecord | null> {
    return [...this.reviews.values()].find((r) => r.jobId === jobId) ?? null;
  }

  async listByProfessionalId(
    professionalProfileId: string,
    options: ListProfessionalReviewsOptions,
  ): Promise<ReviewRecord[]> {
    return [...this.reviews.values()]
      .filter((r) => r.revieweeProfessionalProfileId === professionalProfileId && r.status === "PUBLISHED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    const matches = [...this.reviews.values()].filter(
      (r) => r.revieweeProfessionalProfileId === professionalProfileId && r.status === "PUBLISHED",
    );
    if (matches.length === 0) {
      return { professionalProfileId, averageRating: null, reviewCount: 0 };
    }
    const sum = matches.reduce((total, r) => total + r.rating, 0);
    const averageRating = Math.round((sum / matches.length) * 10) / 10;
    return { professionalProfileId, averageRating, reviewCount: matches.length };
  }

  async create(data: CreateReviewData): Promise<ReviewRecord> {
    // Mirrors the DB unique constraint on jobId. Deliberately no `await`
    // between the check and the write below (unlike `findByJobId`) — that
    // keeps this whole method's body synchronous once entered, so two
    // "concurrent" calls (via Promise.allSettled) can never interleave
    // mid-check: whichever call reaches this method first runs its
    // check-then-set to completion atomically, exactly the way the real
    // DB unique index guarantees under real concurrency. Using `await
    // this.findByJobId(...)` here instead would introduce a yield point
    // and let both calls pass the check before either writes — the same
    // class of bug PrismaReviewRepository.create avoids by relying on the
    // database's own atomic unique-constraint check rather than a
    // check-then-write race in application code.
    const existing = [...this.reviews.values()].find((r) => r.jobId === data.jobId);
    if (existing) {
      throw new ConflictError("A review already exists for this job.");
    }

    this.idCounter += 1;
    const now = new Date();
    const record: ReviewRecord = {
      id: `fake-review-${this.idCounter}`,
      jobId: data.jobId,
      serviceRequestId: data.serviceRequestId,
      reviewerId: data.reviewerId,
      revieweeProfessionalProfileId: data.revieweeProfessionalProfileId,
      revieweeCompanyProfileId: data.revieweeCompanyProfileId,
      rating: data.rating,
      comment: data.comment,
      status: "PUBLISHED",
      createdAt: now,
      updatedAt: now,
    };
    this.reviews.set(record.id, record);
    return record;
  }
}
