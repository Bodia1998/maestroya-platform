import { ConflictError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { deriveMembershipStatus } from "@/domain/services/company-membership-rules";
import { hashInvitationToken, isInvitationActionable } from "@/domain/services/company-invitation-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";

/**
 * Module 18 — Company Professional: accepts a pending invitation for the
 * *authenticated* user. The raw token is hashed here before ever touching
 * the repository — the stored `tokenHash` is the only thing compared
 * against.
 *
 * Security-critical checks, all server-side:
 *   - The invitation must be PENDING and not expired (isInvitationActionable)
 *     — an EXPIRED/DECLINED/CANCELLED/already-ACCEPTED invitation is
 *     rejected, never silently re-accepted.
 *   - The invitation must belong to *this* authenticated user: if
 *     `invitedUserId` was resolved at creation time, it must equal the
 *     caller's id; if the invitation predates the invitee having an account
 *     (`invitedUserId` null), the caller's own email must match the
 *     invitation's email (case-insensitive). Either way, an invitation can
 *     never be accepted by a different authenticated user than the one it
 *     was addressed to — this is the exact "wrong user" attack the module
 *     spec calls out.
 *   - A duplicate-active-membership is rejected (ConflictError) rather than
 *     silently creating a second row.
 */
export class AcceptCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly memberships: CompanyMembershipRepository,
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

    const acceptingUser = await this.users.findById(userId);
    const belongsToCaller = invitation.invitedUserId
      ? invitation.invitedUserId === userId
      : !!acceptingUser?.email && acceptingUser.email.toLowerCase() === invitation.email.toLowerCase();
    if (!belongsToCaller) {
      throw new UnauthorizedError("This invitation was not addressed to your account.");
    }

    const existingMembership = await this.memberships.findByCompanyAndUser(invitation.companyId, userId);
    if (existingMembership && deriveMembershipStatus(existingMembership) === "ACTIVE") {
      throw new ConflictError("You are already a member of this company.");
    }

    await this.memberships.createFromAcceptedInvitation(invitation.companyId, userId, invitation.role);
    const updated = await this.invitations.updateStatus(invitation.id, {
      status: "ACCEPTED",
      acceptedAt: new Date(),
    });

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_INVITATION_ACCEPTED",
      targetType: "CompanyInvitation",
      targetId: invitation.id,
      metadata: { companyId: invitation.companyId, role: invitation.role },
    });

    try {
      await this.notifications.notify({
        userId: invitation.invitedByUserId,
        type: "COMPANY_INVITATION_ACCEPTED",
        title: "Invitation accepted",
        message: "A pending company invitation was accepted.",
        resourceType: "COMPANY",
        resourceId: invitation.companyId,
        actionUrl: "/dashboard/company/members",
      });
    } catch (error) {
      console.error("Failed to create company-invitation-accepted notification", error);
    }

    return updated;
  }
}
