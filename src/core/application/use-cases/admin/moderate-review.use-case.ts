import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminRepository, AdminReviewRecord } from "@/domain/repositories/admin-repository";
import { NotFoundError } from "@/domain/errors/domain-error";

/**
 * Admin Panel module (Module 16): hides a Review from public surfaces by
 * setting Review.status = REMOVED — the field/enum already existed (see
 * schema.prisma's Review model doc comment, which explicitly anticipated
 * this module). Module 13's own public-facing queries (listing, rating
 * aggregation — see PrismaReviewRepository) already filter to PUBLISHED
 * only, so this is a soft moderation, never a destructive delete: the row,
 * its rating, and its history are preserved. Records an audit log entry on
 * success.
 */
export class ModerateReviewUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, reviewId: string, reason: string | null): Promise<AdminReviewRecord> {
    const existing = await this.admins.getReviewById(reviewId);
    if (!existing) throw new NotFoundError("Review", reviewId);

    const updated = await this.admins.setReviewStatus(reviewId, "REMOVED");
    if (!updated) throw new NotFoundError("Review", reviewId);

    await this.auditLog.record({
      adminUserId,
      action: "REVIEW_MODERATED",
      targetType: "Review",
      targetId: reviewId,
      metadata: { previousStatus: existing.status, reason },
    });

    return updated;
  }
}
