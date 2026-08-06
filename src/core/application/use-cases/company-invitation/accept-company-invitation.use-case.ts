import { ConflictError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { deriveMembershipStatus } from "@/domain/services/company-membership-rules";
import { hashInvitationToken, isInvitationActionable } from "@/domain/services/company-invitation-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

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
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the inviter itself — both happen because
 * `CompanyInvitationStatusChanged` is published through the Module 34
 * `EventBus`, reacted to by `RecordCompanyInvitationAuditLogSubscriber`/
 * `NotifyCompanyInvitationStatusChangeSubscriber`. See
 * `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 * identical publish-and-report-don't-rethrow rationale, mirrored here
 * exactly.
 */
export class AcceptCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly users: UserRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
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

    try {
      await this.eventBus.publishAll([
        new CompanyInvitationStatusChanged(
          invitation.id,
          invitation.companyId,
          invitation.invitedByUserId,
          userId,
          "ACCEPTED",
          "ACCEPTED",
          invitation.role,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
