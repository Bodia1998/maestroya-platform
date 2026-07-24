import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { isReactivatableStatus } from "@/domain/services/admin-rules";

/**
 * Admin Panel module (Module 16): reactivates a SUSPENDED or DEACTIVATED
 * user by setting User.status = ACTIVE. Records an audit log entry on
 * success. Deliberately does not reactivate a BANNED user — that is a
 * heavier, deliberately out-of-scope action for this module (see
 * docs/MODULE_16_ADMIN_PANEL.md).
 */
export class ReactivateAdminUserUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, targetUserId: string): Promise<AdminUserRecord> {
    const target = await this.admins.getUserById(targetUserId);
    if (!target) throw new NotFoundError("User", targetUserId);

    if (!isReactivatableStatus(target.status)) {
      throw new ValidationError(`User is not in a reactivatable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setUserStatus(targetUserId, "ACTIVE");
    if (!updated) throw new NotFoundError("User", targetUserId);

    await this.auditLog.record({
      adminUserId,
      action: "USER_REACTIVATED",
      targetType: "User",
      targetId: targetUserId,
      metadata: { previousStatus: target.status },
    });

    return updated;
  }
}
