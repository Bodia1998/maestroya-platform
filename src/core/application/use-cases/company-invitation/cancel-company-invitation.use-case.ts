import { NotFoundError, UnauthorizedError, ConflictError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canCancelInvitation } from "@/domain/services/company-membership-rules";
import { canTransitionInvitation } from "@/domain/services/company-invitation-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: cancels a PENDING invitation.
 *  OWNER/ADMIN only, and only for an invitation belonging to their own
 *  company (a foreign invitationId surfaces as NotFoundError). */
export class CancelCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly auditLog: AdminAuditLogRepository,
  ) {}

  async execute(userId: string, companyId: string, invitationId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canCancelInvitation(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may cancel invitations.");
    }

    const invitation = await this.invitations.findById(invitationId);
    if (!invitation || invitation.companyId !== companyId) {
      throw new NotFoundError("CompanyInvitation", invitationId);
    }

    if (!canTransitionInvitation(invitation.status, "CANCELLED")) {
      throw new ConflictError("This invitation can no longer be cancelled.");
    }

    await this.invitations.updateStatus(invitationId, { status: "CANCELLED", cancelledAt: new Date() });

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_INVITATION_CANCELLED",
      targetType: "CompanyInvitation",
      targetId: invitationId,
      metadata: { companyId },
    });
  }
}
