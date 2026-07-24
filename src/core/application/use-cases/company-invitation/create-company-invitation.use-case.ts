import { ConflictError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { canInviteMembers, deriveMembershipStatus } from "@/domain/services/company-membership-rules";
import { computeInvitationExpiresAt, generateInvitationToken, isInvitableRole } from "@/domain/services/company-invitation-rules";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { CreateCompanyInvitationInput } from "@/application/dto/company-invitation.dto";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface CreateCompanyInvitationResult {
  invitation: CompanyInvitationRecord;
  /** The raw, unhashed token — returned once, at creation time, so the
   *  caller (Server Action) can build the invitation link. Never persisted;
   *  only `tokenHash` is stored (see CompanyInvitation.tokenHash's doc
   *  comment). */
  token: string;
}

/**
 * Module 18 — Company Professional: invites an existing MaestroYa user to
 * join a company. Scope: existing users only, resolved server-side by
 * email — an email that doesn't match any account still creates the
 * invitation row (so a company can invite ahead of signup) but
 * `invitedUserId` stays null and AcceptCompanyInvitationUseCase requires the
 * *authenticated* accepting user's own email to match, so it can never be
 * accepted by an arbitrary account (see that use case).
 *
 * Only OWNER/ADMIN may invite (canInviteMembers). An invitation can never
 * grant OWNER (isInvitableRole excludes it — enforced here, not just in the
 * DTO). At most one PENDING invitation may exist per (companyId, email) —
 * checked here and backed by a DB partial unique index as the final
 * concurrency guarantee.
 */
export class CreateCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly users: UserRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator,
  ) {}

  async execute(
    userId: string,
    companyId: string,
    input: CreateCompanyInvitationInput,
  ): Promise<CreateCompanyInvitationResult> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canInviteMembers(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may invite members.");
    }
    if (!isInvitableRole(input.role)) {
      throw new ValidationError("Invalid role for an invitation.");
    }

    const existingPending = await this.invitations.findPendingByCompanyAndEmail(companyId, input.email);
    if (existingPending) {
      throw new ConflictError("There is already a pending invitation for this email address.");
    }

    const invitedUser = await this.users.findByEmail(input.email);
    if (invitedUser) {
      const existingMembership = await this.memberships.findByCompanyAndUser(companyId, invitedUser.id);
      if (existingMembership && deriveMembershipStatus(existingMembership) === "ACTIVE") {
        throw new ConflictError("This user is already a member of the company.");
      }
    }

    const now = new Date();
    const { token, tokenHash } = generateInvitationToken();

    const invitation = await this.invitations.create({
      companyId,
      email: input.email,
      invitedUserId: invitedUser?.id ?? null,
      invitedByUserId: userId,
      role: input.role,
      tokenHash,
      expiresAt: computeInvitationExpiresAt(now),
    });

    await this.auditLog.record({
      adminUserId: userId,
      action: "COMPANY_MEMBER_INVITED",
      targetType: "CompanyInvitation",
      targetId: invitation.id,
      metadata: { companyId, email: input.email, role: input.role },
    });

    if (invitedUser) {
      try {
        await this.notifications.notify({
          userId: invitedUser.id,
          type: "COMPANY_INVITATION_RECEIVED",
          title: "You've been invited to join a company",
          message: "You have a pending company invitation.",
          resourceType: "COMPANY_INVITATION",
          resourceId: invitation.id,
          actionUrl: "/dashboard/company/invitations",
        });
      } catch (error) {
        console.error("Failed to create company-invitation-received notification", error);
      }
    }

    return { invitation, token };
  }
}
