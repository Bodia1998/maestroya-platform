import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminCompanyRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { canTransitionCompanyStatus } from "@/domain/services/company-rules";

/** Module 18 — Company Professional: an admin reactivates a SUSPENDED
 *  company back to ACTIVE. Mirrors ReactivateAdminUserUseCase. */
export class ReactivateCompanyUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(adminUserId: string, companyId: string): Promise<AdminCompanyRecord> {
    const target = await this.admins.getCompanyById(companyId);
    if (!target) throw new NotFoundError("Company", companyId);

    if (!canTransitionCompanyStatus(target.status, "ACTIVE")) {
      throw new ConflictError(`Company is not in a reactivatable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setCompanyStatus(companyId, "ACTIVE", null);
    if (!updated) throw new NotFoundError("Company", companyId);

    await this.auditLog.record({
      adminUserId,
      action: "COMPANY_REACTIVATED",
      targetType: "Company",
      targetId: companyId,
      metadata: { previousStatus: target.status },
    });

    try {
      await this.notifications.notify({
        userId: target.ownerUserId,
        type: "COMPANY_REACTIVATED",
        title: "Your company has been reactivated",
        message: "Your company profile is active again.",
        resourceType: "COMPANY",
        resourceId: companyId,
      });
    } catch (error) {
      console.error("Failed to create company-reactivated notification", error);
    }

    return updated;
  }
}
