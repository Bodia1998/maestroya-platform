import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";

const ADMIN_ROLE_KEYS = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Admin Panel module (Module 16): replaces a user's entire role set.
 * Validates every requested role key against the Role table (so an
 * unrecognized/injected key is rejected, not silently ignored or stored),
 * and refuses a change that would leave the platform with zero remaining
 * ACTIVE admins. Records an audit log entry on success.
 */
export class ChangeUserRoleUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(adminUserId: string, targetUserId: string, roleKeys: string[]): Promise<AdminUserRecord> {
    const target = await this.admins.getUserById(targetUserId);
    if (!target) throw new NotFoundError("User", targetUserId);

    if (roleKeys.length === 0) {
      throw new ValidationError("At least one role is required.");
    }

    const validRoleKeys = new Set(await this.admins.listRoleKeys());
    const uniqueRequested = Array.from(new Set(roleKeys));
    const unknown = uniqueRequested.filter((key) => !validRoleKeys.has(key));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown role(s): ${unknown.join(", ")}.`);
    }

    const targetIsCurrentlyAdmin = target.roles.some((key) => ADMIN_ROLE_KEYS.has(key));
    const targetWouldBeAdmin = uniqueRequested.some((key) => ADMIN_ROLE_KEYS.has(key));

    if (targetIsCurrentlyAdmin && !targetWouldBeAdmin) {
      // This change removes admin privileges from `target` — make sure at
      // least one other ACTIVE admin remains afterward.
      const activeAdmins = await this.admins.countActiveAdmins();
      const targetCountsAsActiveAdmin = target.status === "ACTIVE";
      const remainingAfterChange = activeAdmins - (targetCountsAsActiveAdmin ? 1 : 0);
      if (remainingAfterChange <= 0) {
        throw new ConflictError("Cannot remove the last remaining admin's admin role.");
      }
    }

    const updated = await this.admins.setUserRoles(targetUserId, uniqueRequested);
    if (!updated) throw new NotFoundError("User", targetUserId);

    await this.auditLog.record({
      adminUserId,
      action: "USER_ROLE_CHANGED",
      targetType: "User",
      targetId: targetUserId,
      metadata: { previousRoles: target.roles, newRoles: uniqueRequested },
    });

    return updated;
  }
}
