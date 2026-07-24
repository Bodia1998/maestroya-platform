import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import {
  canInitiateOwnershipTransfer,
  deriveMembershipStatus,
  isEligibleOwnershipTransferTarget,
} from "@/domain/services/company-membership-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: transfers company ownership from the
 * current OWNER to another existing, active member — the only path by which
 * OWNER ever changes hands (see canInitiateOwnershipTransfer/
 * isEligibleOwnershipTransferTarget). Updates CompanyProfile.ownerUserId and
 * both members' roles (outgoing OWNER → ADMIN, incoming → OWNER) — the
 * repository is expected to perform this atomically (see
 * CompanyMembershipRepository.transferOwnership's own doc comment).
 */
export class TransferCompanyOwnershipUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(userId: string, companyId: string, newOwnerMemberId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canInitiateOwnershipTransfer(actor.role)) {
      throw new UnauthorizedError("Only the current company owner may transfer ownership.");
    }

    const target = await this.memberships.findById(newOwnerMemberId);
    if (!target || target.companyId !== companyId) {
      throw new NotFoundError("CompanyMember", newOwnerMemberId);
    }

    const targetStatus = deriveMembershipStatus(target);
    if (!isEligibleOwnershipTransferTarget(targetStatus, target.id === actor.memberId)) {
      throw new ValidationError("Ownership can only be transferred to another active member of this company.");
    }

    await this.memberships.transferOwnership(companyId, actor.memberId, target.id);
    await this.companies.updateOwner(companyId, target.userId);

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_OWNERSHIP_TRANSFERRED",
      targetType: "Company",
      targetId: companyId,
      metadata: { fromUserId: userId, toUserId: target.userId },
    });

    try {
      await this.notifications.notify({
        userId: target.userId,
        type: "COMPANY_MEMBER_ROLE_CHANGED",
        title: "You are now the company owner",
        message: "Ownership of the company has been transferred to you.",
        resourceType: "COMPANY",
        resourceId: companyId,
        actionUrl: "/dashboard/company/profile",
      });
    } catch (error) {
      console.error("Failed to create ownership-transfer notification", error);
    }
  }
}
