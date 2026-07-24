import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canRemoveMember, deriveMembershipStatus } from "@/domain/services/company-membership-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: removes (soft-removes — sets
 * `removedAt`, never a hard delete) a member from a company. The OWNER can
 * never be removed this way, including by themself — ownership must be
 * transferred first (see TransferCompanyOwnershipUseCase and
 * canRemoveMember's own doc comment). A member may remove themself
 * (leaving the company) if their own role permits removing a member of
 * their own rank — MEMBER/MANAGER leaving is always allowed via this same
 * rule (canRemoveMember treats "removing yourself" as removing a member of
 * your own current role, which every role can do to itself except OWNER).
 */
export class RemoveCompanyMemberUseCase {
  constructor(
    private readonly memberships: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(userId: string, companyId: string, memberId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);

    const target = await this.memberships.findById(memberId);
    if (!target || target.companyId !== companyId || deriveMembershipStatus(target) !== "ACTIVE") {
      throw new NotFoundError("CompanyMember", memberId);
    }

    const isSelfRemoval = target.id === actor.memberId;
    if (!isSelfRemoval && !canRemoveMember(actor.role, target.role)) {
      throw new UnauthorizedError("You do not have permission to remove this member.");
    }
    if (isSelfRemoval && target.role === "OWNER") {
      throw new UnauthorizedError("The company owner cannot leave without transferring ownership first.");
    }

    await this.memberships.remove(memberId, new Date());

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_MEMBER_REMOVED",
      targetType: "CompanyMember",
      targetId: memberId,
      metadata: { companyId, role: target.role, selfRemoval: isSelfRemoval },
    });

    try {
      await this.notifications.notify({
        userId: target.userId,
        type: "COMPANY_MEMBER_REMOVED",
        title: "You have been removed from a company",
        message: "You are no longer a member of this company.",
        resourceType: "COMPANY",
        resourceId: companyId,
      });
    } catch (error) {
      console.error("Failed to create company-member-removed notification", error);
    }
  }
}
