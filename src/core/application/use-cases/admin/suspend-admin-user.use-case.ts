import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { isSuspendableStatus } from "@/domain/services/admin-rules";

/**
 * Admin Panel module (Module 16): suspends a user by setting
 * User.status = SUSPENDED (the field already existed — see
 * schema.prisma's UserStatus enum, added by an earlier module). Refuses to
 * suspend the last remaining ACTIVE admin (ADMIN/SUPER_ADMIN role holder)
 * so the platform can never be left with zero admins able to reverse a
 * mistake. Records an audit log entry on success.
 */
export class SuspendAdminUserUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, targetUserId: string): Promise<AdminUserRecord> {
    const target = await this.admins.getUserById(targetUserId);
    if (!target) throw new NotFoundError("User", targetUserId);

    if (!isSuspendableStatus(target.status)) {
      throw new ValidationError(`User is not in a suspendable state (current status: ${target.status}).`);
    }

    const isAdmin = target.roles.includes("ADMIN") || target.roles.includes("SUPER_ADMIN");
    if (isAdmin) {
      const activeAdmins = await this.admins.countActiveAdmins();
      if (activeAdmins <= 1) {
        throw new ConflictError("Cannot suspend the last remaining admin.");
      }
    }

    const updated = await this.admins.setUserStatus(targetUserId, "SUSPENDED");
    if (!updated) throw new NotFoundError("User", targetUserId);

    await this.auditLog.record({
      adminUserId,
      action: "USER_SUSPENDED",
      targetType: "User",
      targetId: targetUserId,
      metadata: { previousStatus: target.status },
    });

    return updated;
  }
}
