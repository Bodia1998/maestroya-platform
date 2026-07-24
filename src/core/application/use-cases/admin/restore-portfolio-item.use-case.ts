import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminPortfolioItemRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import { NotFoundError } from "@/domain/errors/domain-error";

/**
 * Admin Panel module (Module 16): restores a previously-moderated
 * PortfolioItem by clearing `moderatedAt`, making it visible on public/
 * professional listings again. Records an audit log entry on success.
 */
export class RestorePortfolioItemUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, portfolioItemId: string): Promise<AdminPortfolioItemRecord> {
    const existing = await this.admins.getPortfolioItemById(portfolioItemId);
    if (!existing) throw new NotFoundError("PortfolioItem", portfolioItemId);

    const updated = await this.admins.setPortfolioItemModeratedAt(portfolioItemId, null);
    if (!updated) throw new NotFoundError("PortfolioItem", portfolioItemId);

    await this.auditLog.record({
      adminUserId,
      action: "PORTFOLIO_ITEM_RESTORED",
      targetType: "PortfolioItem",
      targetId: portfolioItemId,
      metadata: {},
    });

    return updated;
  }
}
