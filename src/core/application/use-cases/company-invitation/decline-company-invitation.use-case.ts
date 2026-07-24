import { ConflictError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashInvitationToken, isInvitationActionable } from "@/domain/services/company-invitation-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/** Module 18 — Company Professional: declines a pending invitation. Same
 *  "belongs to this authenticated user" check as AcceptCompanyInvitationUseCase. */
export class DeclineCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly users: UserRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(userId: string, token: string): Promise<CompanyInvitationRecord> {
    const tokenHash = hashInvitationToken(token);
    const invitation = await this.invitations.findByTokenHash(tokenHash);
    if (!invitation) {
      throw new NotFoundError("CompanyInvitation", token);
    }

    if (!isInvitationActionable(invitation.status, invitation.expiresAt, new Date())) {
      throw new ConflictError("This invitation is no longer valid.");
    }

    const decliningUser = await this.users.findById(userId);
    const belongsToCaller = invitation.invitedUserId
      ? invitation.invitedUserId === userId
      : !!decliningUser?.email && decliningUser.email.toLowerCase() === invitation.email.toLowerCase();
    if (!belongsToCaller) {
      throw new UnauthorizedError("This invitation was not addressed to your account.");
    }

    const updated = await this.invitations.updateStatus(invitation.id, {
      status: "DECLINED",
      declinedAt: new Date(),
    });

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_INVITATION_DECLINED",
      targetType: "CompanyInvitation",
      targetId: invitation.id,
      metadata: { companyId: invitation.companyId },
    });

    try {
      await this.notifications.notify({
        userId: invitation.invitedByUserId,
        type: "COMPANY_INVITATION_DECLINED",
        title: "Invitation declined",
        message: "A pending company invitation was declined.",
        resourceType: "COMPANY",
        resourceId: invitation.companyId,
        actionUrl: "/dashboard/company/invitations",
      });
    } catch (error) {
      console.error("Failed to create company-invitation-declined notification", error);
    }

    return updated;
  }
}
