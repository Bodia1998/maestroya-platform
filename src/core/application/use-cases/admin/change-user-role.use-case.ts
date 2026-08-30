import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import type { SecurityEventRepository } from "@/domain/repositories/security-event-repository";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";

const ADMIN_ROLE_KEYS = new Set(["ADMIN", "SUPER_ADMIN"]);

/**
 * Admin Panel module (Module 16): replaces a user's entire role set.
 * Validates every requested role key against the Role table (so an
 * unrecognized/injected key is rejected, not silently ignored or stored),
 * and refuses a change that would leave the platform with zero remaining
 * ACTIVE admins. Records an audit log entry on success.
 *
 * Module 82 — Admin RBAC & Production Auth Hardening (finding B1): granting
 * ADMIN or SUPER_ADMIN is additionally gated on the *caller* currently
 * holding SUPER_ADMIN. This is the actual server-side authorization
 * boundary for that rule — not the Server Action's `requireRole(ADMIN,
 * SUPER_ADMIN)` (which only proves "an admin of some kind is calling",
 * exactly the gap the audit flagged), and not the admin UI (which never
 * enforces anything on its own — see admin/actions.ts's own doc comment).
 * A direct call to this use case — whether from the real Server Action or
 * any future caller — cannot grant ADMIN/SUPER_ADMIN without the caller
 * genuinely holding SUPER_ADMIN right now.
 *
 * "Right now" matters: the caller's role is re-read from `this.admins`
 * (a fresh DB read) rather than trusted from whatever role claim the
 * Server Action's session/JWT happened to carry, closing the same
 * stale-privilege gap `requireRole()` closes at the Server Action layer
 * (see infrastructure/auth/rbac.ts) — belt-and-suspenders, since this is
 * the one use case where getting it wrong grants privileges rather than
 * merely allowing an already-privileged action.
 */
export class ChangeUserRoleUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly securityEvents: SecurityEventRepository,
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

    const targetWouldBeAdmin = uniqueRequested.some((key) => ADMIN_ROLE_KEYS.has(key));

    if (targetWouldBeAdmin) {
      // B1 — ADMIN privilege escalation. Covers every case the audit
      // named: an ADMIN granting ADMIN to someone else, an ADMIN granting
      // SUPER_ADMIN, and an ADMIN self-promoting (targetUserId ===
      // adminUserId is just another case of "caller lacks SUPER_ADMIN",
      // no special-casing needed).
      const caller = await this.admins.getUserById(adminUserId);
      const callerIsSuperAdmin = caller?.roles.includes("SUPER_ADMIN") ?? false;

      if (!callerIsSuperAdmin) {
        // Security-denial audit trail: reuses the existing, already-
        // defined-but-unused SECURITY_POLICY_BLOCKED SecurityEvent type
        // (see security-event-repository.ts) rather than inventing a
        // second audit system or overloading AdminAuditLogRepository's
        // USER_ROLE_CHANGED action for a change that never happened.
        // Metadata is limited to what's needed to investigate the
        // attempt — no email, name, or other PII.
        await this.securityEvents.record({
          type: "SECURITY_POLICY_BLOCKED",
          userId: adminUserId,
          metadata: {
            policy: "ADMIN_ROLE_ESCALATION_DENIED",
            targetUserId,
            requestedRoles: uniqueRequested.filter((key) => ADMIN_ROLE_KEYS.has(key)),
          },
        });

        throw new UnauthorizedError("Only a SUPER_ADMIN may grant ADMIN or SUPER_ADMIN privileges.");
      }
    }

    const targetIsCurrentlyAdmin = target.roles.some((key) => ADMIN_ROLE_KEYS.has(key));

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
