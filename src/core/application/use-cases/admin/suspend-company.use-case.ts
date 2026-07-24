import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminCompanyRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { canTransitionCompanyStatus } from "@/domain/services/company-rules";

/**
 * Module 18 — Company Professional: an admin suspends a company
 * (ACTIVE/PENDING → SUSPENDED). Mirrors SuspendAdminUserUseCase — a thin,
 * auditable state transition, never a business-logic reimplementation.
 * Notifies the company's owner (best-effort).
 */
export class SuspendCompanyUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, companyId: string): Promise<AdminCompanyRecord> {
    const target = await this.admins.getCompanyById(companyId);
    if (!target) throw new NotFoundError("Company", companyId);

    if (!canTransitionCompanyStatus(target.status, "SUSPENDED")) {
      throw new ConflictError(`Company is not in a suspendable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setCompanyStatus(companyId, "SUSPENDED", new Date());
    if (!updated) throw new NotFoundError("Company", companyId);

    await this.auditLog.record({
      adminUserId,
      action: "COMPANY_SUSPENDED",
      targetType: "Company",
      targetId: companyId,
      metadata: { previousStatus: target.status },
    });

    try {
      await this.notifications.notify({
        userId: target.ownerUserId,
        type: "COMPANY_SUSPENDED",
        title: "Your company has been suspended",
        message: "Your company profile has been suspended by a platform administrator.",
        resourceType: "COMPANY",
        resourceId: companyId,
      });
    } catch (error) {
      console.error("Failed to create company-suspended notification", error);
    }

    return updated;
  }
}
