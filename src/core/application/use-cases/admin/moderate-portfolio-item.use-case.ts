import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminPortfolioItemRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import { NotFoundError } from "@/domain/errors/domain-error";

/**
 * Admin Panel module (Module 16): hides a PortfolioItem from public/
 * professional listings by setting PortfolioItem.moderatedAt (added by
 * this module — see schema.prisma's doc comment on that field). Never
 * touches `deletedAt` — that remains the owner's own soft-delete concept
 * (Module 14), kept strictly separate from admin moderation. Records an
 * audit log entry on success.
 */
export class ModeratePortfolioItemUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, portfolioItemId: string, reason: string | null): Promise<AdminPortfolioItemRecord> {
    const existing = await this.admins.getPortfolioItemById(portfolioItemId);
    if (!existing) throw new NotFoundError("PortfolioItem", portfolioItemId);

    const updated = await this.admins.setPortfolioItemModeratedAt(portfolioItemId, new Date());
    if (!updated) throw new NotFoundError("PortfolioItem", portfolioItemId);

    await this.auditLog.record({
      adminUserId,
      action: "PORTFOLIO_ITEM_MODERATED",
      targetType: "PortfolioItem",
      targetId: portfolioItemId,
      metadata: { reason },
    });

    return updated;
  }
}
