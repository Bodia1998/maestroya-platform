import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminRepository, AdminReviewRecord } from "@/domain/repositories/admin-repository";
import { NotFoundError } from "@/domain/errors/domain-error";

/**
 * Admin Panel module (Module 16): restores a previously-moderated Review by
 * setting Review.status back to PUBLISHED, making it visible on public
 * surfaces again. Records an audit log entry on success.
 */
export class RestoreReviewUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, reviewId: string): Promise<AdminReviewRecord> {
    const existing = await this.admins.getReviewById(reviewId);
    if (!existing) throw new NotFoundError("Review", reviewId);

    const updated = await this.admins.setReviewStatus(reviewId, "PUBLISHED");
    if (!updated) throw new NotFoundError("Review", reviewId);

    await this.auditLog.record({
      adminUserId,
      action: "REVIEW_RESTORED",
      targetType: "Review",
      targetId: reviewId,
      metadata: { previousStatus: existing.status },
    });

    return updated;
  }
}
