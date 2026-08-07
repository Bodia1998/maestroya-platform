import { ConflictError } from "@/domain/errors/domain-error";
import { emptyRatingDistribution } from "@/domain/services/review-rules";
import type {
  CreateReviewData,
  ListProfessionalReviewsOptions,
  ProfessionalRatingSummary,
  ReviewRecord,
  ReviewRepository,
  UpdateReviewData,
} from "@/domain/repositories/review-repository";
import type {
  AdminAuditAction,
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";

let auditLogIdCounter = 0;

/**
 * Module 41 — Reviews & Ratings: in-memory `AdminAuditLogRepository` test
 * double, same shape as every other module's own copy (see
 * tests/integration/dispute/fakes.ts's identically-named class) — this
 * module's audit-log subscribers write through this interface, not a
 * Review-specific one, so the fake is duplicated per-module rather than
 * shared, matching this codebase's existing convention.
 */
export class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    auditLogIdCounter += 1;
    const record: AdminAuditLogRecord = {
      id: `fake-audit-log-${auditLogIdCounter}`,
      adminUserId: data.adminUserId,
      action: data.action as AdminAuditAction,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.entries.push(record);
    return record;
  }

  async list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [...this.entries].reverse().slice(options.offset, options.offset + options.limit);
  }
}

/** Module 41 — Reviews & Ratings: in-memory `NotificationCreator` test
 *  double — same shape as `FakeNotificationCreator` in
 *  tests/integration/verification/fakes.ts. */
export class FakeNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * In-memory test double for the Reviews & Ratings module, following the
 * same pattern as every other module's fakes.ts (see
 * tests/integration/booking/fakes.ts's own doc comment): implements the
 * real ReviewRepository interface so CreateReviewUseCase/GetReviewByJobUseCase/
 * UpdateReviewUseCase/DeleteReviewUseCase/RespondToReviewUseCase/etc. run
 * their genuine orchestration/authorization logic, with only storage
 * swapped out.
 *
 * Mirrors PrismaReviewRepository's safety properties so tests exercise real
 * behavior, not a stub that always succeeds:
 *   1. `findByJobId` enforces at most one row per Job (a Map keyed by
 *      review id, filtered by jobId — same shape as the real unique index).
 *   2. `create` throws ConflictError if a row for that `jobId` already
 *      exists — the in-memory equivalent of the DB unique-constraint
 *      violation PrismaReviewRepository.create translates from Prisma's
 *      P2002. Every precondition is checked *before* any mutation, so two
 *      concurrent `create` calls racing through this fake behave the same
 *      way two concurrent requests racing through the real transactional
 *      unique index would: exactly one wins.
 *   3. `listByProfessionalId`/`getProfessionalRatingSummary` (Module 41)
 *      only ever consider PUBLISHED, non-deleted rows — same filter
 *      PrismaReviewRepository's `PUBLIC_WHERE` applies.
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

  private isPublic(r: ReviewRecord): boolean {
    return r.status === "PUBLISHED" && r.deletedAt === null;
  }

  async listByProfessionalId(
    professionalProfileId: string,
    options: ListProfessionalReviewsOptions,
  ): Promise<ReviewRecord[]> {
    return [...this.reviews.values()]
      .filter(
        (r) =>
          r.revieweeProfessionalProfileId === professionalProfileId &&
          this.isPublic(r) &&
          (options.rating === undefined || r.rating === options.rating),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    const matches = [...this.reviews.values()].filter(
      (r) => r.revieweeProfessionalProfileId === professionalProfileId && this.isPublic(r),
    );
    const ratingDistribution = emptyRatingDistribution();
    if (matches.length === 0) {
      return { professionalProfileId, averageRating: null, reviewCount: 0, ratingDistribution, lastReviewAt: null };
    }
    let sum = 0;
    let lastReviewAt: Date | null = null;
    for (const r of matches) {
      sum += r.rating;
      ratingDistribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
      if (!lastReviewAt || r.createdAt > lastReviewAt) lastReviewAt = r.createdAt;
    }
    const averageRating = Math.round((sum / matches.length) * 10) / 10;
    return { professionalProfileId, averageRating, reviewCount: matches.length, ratingDistribution, lastReviewAt };
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
      response: null,
      respondedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.reviews.set(record.id, record);
    return record;
  }

  async update(id: string, data: UpdateReviewData): Promise<ReviewRecord | null> {
    const existing = this.reviews.get(id);
    if (!existing) return null;
    const updated: ReviewRecord = { ...existing, rating: data.rating, comment: data.comment, updatedAt: new Date() };
    this.reviews.set(id, updated);
    return updated;
  }

  async softDelete(id: string): Promise<ReviewRecord | null> {
    const existing = this.reviews.get(id);
    if (!existing) return null;
    const updated: ReviewRecord = { ...existing, deletedAt: new Date(), updatedAt: new Date() };
    this.reviews.set(id, updated);
    return updated;
  }

  async respond(id: string, response: string): Promise<ReviewRecord | null> {
    const existing = this.reviews.get(id);
    if (!existing) return null;
    const updated: ReviewRecord = { ...existing, response, respondedAt: new Date(), updatedAt: new Date() };
    this.reviews.set(id, updated);
    return updated;
  }
}
