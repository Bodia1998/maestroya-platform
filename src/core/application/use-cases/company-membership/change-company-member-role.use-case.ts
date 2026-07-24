import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMemberRecord, CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canChangeMemberRole, deriveMembershipStatus, type CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: changes a member's role. Re-derives the
 * caller's own role from their session-scoped membership (never trusted
 * from client input) and re-checks `canChangeMemberRole` server-side
 * regardless of what the UI allowed. The target member must belong to the
 * same company the caller is resolved against — a memberId from a different
 * company surfaces as NotFoundError (never leaks whether that id exists
 * elsewhere).
 */
export class ChangeCompanyMemberRoleUseCase {
  constructor(
    private readonly memberships: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(
    userId: string,
    companyId: string,
    memberId: string,
    newRole: CompanyMemberRoleValue,
  ): Promise<CompanyMemberRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);

    const target = await this.memberships.findById(memberId);
    if (!target || target.companyId !== companyId || deriveMembershipStatus(target) !== "ACTIVE") {
      throw new NotFoundError("CompanyMember", memberId);
    }

    if (target.id === actor.memberId) {
      throw new ValidationError("You cannot change your own role.");
    }

    if (!canChangeMemberRole(actor.role, target.role, newRole)) {
      throw new UnauthorizedError("You do not have permission to assign that role.");
    }

    const updated = await this.memberships.updateRole(memberId, newRole);

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_MEMBER_ROLE_CHANGED",
      targetType: "CompanyMember",
      targetId: memberId,
      metadata: { companyId, fromRole: target.role, toRole: newRole },
    });

    try {
      await this.notifications.notify({
        userId: target.userId,
        type: "COMPANY_MEMBER_ROLE_CHANGED",
        title: "Your role has changed",
        message: `Your role in the company was changed to ${newRole}.`,
        resourceType: "COMPANY",
        resourceId: companyId,
        actionUrl: "/dashboard/company/members",
      });
    } catch (error) {
      console.error("Failed to create company-member-role-changed notification", error);
    }

    return updated;
  }
}
